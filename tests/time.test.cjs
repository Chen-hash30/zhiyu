const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../electron/lib/vault.cjs');
const { nowIso, localIso, timezoneSuffix } = require('../electron/lib/util.cjs');

test('新记录使用本地时区偏移而不是 UTC', async () => {
  const value = nowIso();
  assert.match(value, /[+-]\d{2}:\d{2}$/);
  assert.ok(Math.abs(new Date(value).getTime() - Date.now()) < 5000);
  assert.equal(value.endsWith(timezoneSuffix()), true);

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zhiyu-time-'));
  try {
    const vault = new Vault(root);
    await vault.init({ seed: false });
    const note = await vault.importText({
      title: '时间测试',
      content: '这条资料应该记录本地时间。',
      source: 'local',
    });
    const abs = path.join(root, note.path);
    const text = await fsp.readFile(abs, 'utf8');
    const created = /created:\s*'([^']+)'/.exec(text);
    assert.ok(created);
    assert.ok(created[1].endsWith(timezoneSuffix()));
    assert.equal(created[1].endsWith('Z'), false);
    assert.equal(note.created, created[1]);
    assert.match(note.updated, /[+-]\d{2}:\d{2}$/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('已有 UTC 时间会迁移为本地时间且不改正文', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zhiyu-time-'));
  try {
    const vault = new Vault(root);
    await vault.init({ seed: false });
    const note = await vault.importText({
      title: '旧时间资料',
      content: '正文必须原样保留。',
      source: 'local',
    });
    const abs = path.join(root, note.path);
    const original = await fsp.readFile(abs, 'utf8');
    const oldTime = '2026-11-13T10:20:23.257Z';
    const rewritten = original
      .replace(/created:\s*'[^']+'/, `created: '${oldTime}'`)
      .replace(/updated:\s*'[^']+'/, `updated: '${oldTime}'`);
    await fsp.writeFile(abs, rewritten, 'utf8');

    const chatsPath = path.join(root, '.zhiyu', 'chats.json');
    await fsp.writeFile(
      chatsPath,
      JSON.stringify(
        {
          version: 1,
          activeId: 's1',
          sessions: [
            {
              id: 's1',
              title: '时间测试',
              createdAt: oldTime,
              updatedAt: oldTime,
              messages: [
                {
                  id: 'm1',
                  role: 'user',
                  content: oldTime,
                  createdAt: oldTime,
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await vault.migrateLocalTimes({ force: true });
    const migrated = await fsp.readFile(abs, 'utf8');
    const expected = localIso(new Date(oldTime));
    assert.ok(migrated.includes(`created: '${expected}'`));
    assert.ok(migrated.includes(`updated: '${expected}'`));
    assert.ok(migrated.includes('正文必须原样保留。'));
    assert.equal(migrated.includes(oldTime), false);

    const chats = JSON.parse(await fsp.readFile(chatsPath, 'utf8'));
    assert.equal(chats.sessions[0].createdAt, expected);
    assert.equal(chats.sessions[0].updatedAt, expected);
    assert.equal(chats.sessions[0].messages[0].createdAt, expected);
    assert.equal(chats.sessions[0].messages[0].content, oldTime);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});