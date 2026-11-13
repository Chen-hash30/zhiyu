const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { UserError } = require('./util.cjs');

const execFileAsync = promisify(execFile);
let gitAvailableCache = null;

async function git(root, args, options = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30000,
      ...options,
    });
    return stdout.trim();
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    const wrapped = new UserError(output || error.message || 'Git 操作失败');
    wrapped.gitOutput = output;
    wrapped.exitCode = error.code;
    throw wrapped;
  }
}

async function isAvailable() {
  if (gitAvailableCache !== null) return gitAvailableCache;
  try {
    await execFileAsync('git', ['--version'], { windowsHide: true, timeout: 5000 });
    gitAvailableCache = true;
  } catch {
    gitAvailableCache = false;
  }
  return gitAvailableCache;
}

async function isRepo(root) {
  try {
    const out = await git(root, ['rev-parse', '--is-inside-work-tree']);
    return out === 'true';
  } catch {
    return false;
  }
}

async function ensureGitignore(root) {
  const file = path.join(root, '.gitignore');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '.zhiyu/\n.DS_Store\nThumbs.db\n', 'utf8');
  }
}

async function init(root) {
  if (!(await isAvailable())) return false;
  const repo = await isRepo(root);
  if (!repo) {
    try {
      await git(root, ['init', '-b', 'main']);
    } catch {
      await git(root, ['init']);
    }
    await ensureGitignore(root);
    await commit(root, '初始化知识库');
  }
  return true;
}

async function commit(root, message) {
  if (!(await isAvailable())) return null;
  if (!(await isRepo(root))) return null;
  await ensureGitignore(root);
  await git(root, ['add', '-A']);
  let hasChanges = false;
  try {
    await execFileAsync('git', ['diff', '--cached', '--quiet'], {
      cwd: root,
      windowsHide: true,
    });
  } catch (error) {
    if (error.code === 1) hasChanges = true;
    else return null;
  }
  if (!hasChanges) return null;
  await git(root, [
    '-c',
    'user.name=知屿',
    '-c',
    'user.email=local@zhiyu.app',
    'commit',
    '-m',
    String(message || '保存知识库').slice(0, 200),
  ]);
  return git(root, ['rev-parse', 'HEAD']);
}

async function history(root, limit = 30) {
  if (!(await isRepo(root))) return [];
  try {
    const out = await git(root, [
      'log',
      `-${Math.max(1, Math.min(100, limit))}`,
      '--date=format:%Y-%m-%d %H:%M',
      '--pretty=format:%h%x1f%ad%x1f%s',
    ]);
    if (!out) return [];
    return out.split('\n').map((line) => {
      const [hash, date, message] = line.split('\x1f');
      return { hash, date, message };
    });
  } catch {
    return [];
  }
}

async function status(root) {
  const available = await isAvailable();
  if (!available) {
    return { available: false, isRepo: false, history: [] };
  }
  const repo = await isRepo(root);
  if (!repo) {
    return { available: true, isRepo: false, history: [] };
  }
  let latest = null;
  try {
    const out = await git(root, ['log', '-1', '--pretty=format:%h%x1f%ad%x1f%s', '--date=format:%Y-%m-%d %H:%M']);
    if (out) {
      const [hash, date, message] = out.split('\x1f');
      latest = { hash, date, message };
    }
  } catch {
    latest = null;
  }
  return { available: true, isRepo: true, latest, history: await history(root, 20) };
}

async function revert(root, hash) {
  if (!(await isRepo(root))) {
    throw new UserError('这个知识库还没有开启版本快照');
  }
  if (!/^[0-9a-f]{4,40}$/i.test(String(hash || ''))) {
    throw new UserError('版本编号无效');
  }
  try {
    await git(root, [
      '-c',
      'user.name=知屿',
      '-c',
      'user.email=local@zhiyu.app',
      'revert',
      '--no-edit',
      hash,
    ]);
  } catch (error) {
    try {
      await git(root, ['revert', '--abort']);
    } catch {
      // ignore
    }
    throw new UserError('这次整理和之后的修改有冲突，暂时无法自动撤销。可以先创建一个快照再手动处理。');
  }
}

async function bundle(root, snapshotDir) {
  const targetDir = String(snapshotDir || '').trim();
  if (!targetDir) return null;
  if (!(await isRepo(root))) return null;
  const resolvedDir = path.resolve(targetDir);
  const resolvedRoot = path.resolve(root);
  if (resolvedDir === resolvedRoot || resolvedDir.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new UserError('快照备份目录不能放在知识库内部');
  }
  await fs.promises.mkdir(resolvedDir, { recursive: true });
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const safeName = path.basename(root).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 40);
  const target = path.join(resolvedDir, `${safeName}-${timestamp}.bundle`);
  await git(root, ['bundle', 'create', target, '--all']);
  return target;
}

module.exports = {
  isAvailable,
  isRepo,
  init,
  commit,
  history,
  status,
  revert,
  bundle,
  ensureGitignore,
};
