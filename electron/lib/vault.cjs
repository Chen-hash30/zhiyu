const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const matter = require('gray-matter');
const chokidar = require('chokidar');
const {
  SUPPORTED_EXTENSIONS,
  extractDocument,
  decodeText,
} = require('./importers.cjs');
const {
  UserError,
  fail,
  resolveInside,
  slugify,
  excerptOf,
  titleFromBody,
  parseWikiLinks,
  asStringArray,
  isoDate,
  nowIso,
  localDateStamp,
  localDateTime,
  queryTokens,
  stripMarkdown,
  truncate,
  normalizeTitle,
} = require('./util.cjs');

const FOLDERS = {
  concept: 'concepts',
  entity: 'entities',
  source: 'sources',
  note: 'notes',
};

const LARGE_FILE_BYTES = 1_000_000;
const LARGE_PREFIX_BYTES = 400_000;
const MAX_PREVIEW_CHARS = 120_000;

async function readFilePrefix(abs, maxBytes) {
  const handle = await fsp.open(abs, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

const TYPE_LABELS = {
  raw: '资料',
  concept: '概念',
  entity: '实体',
  source: '来源',
  note: '笔记',
  system: '系统',
};

function chatTitleFromMessages(messages = []) {
  const first = messages.find(
    (message) => message?.role === 'user' && String(message.content || '').trim(),
  );
  const text = stripMarkdown(String(first?.content || '')).replace(/\s+/g, ' ').trim();
  return text ? truncate(text, 28) : '新对话';
}

const AGENTS_SEED = `# 知屿整理规则

这份文件是知屿整理资料时遵循的规则。你可以直接修改它，下一次整理就会生效。

## 目录约定

- \`raw/\`：原始资料。网页剪藏、零散想法、导入的文件都从这里开始，只增不改。
- \`wiki/concepts/\`：概念。解释一个想法是什么、为什么重要、怎么用。
- \`wiki/entities/\`：实体。人物、产品、组织、书籍等具体对象。
- \`wiki/sources/\`：来源。对一份原始资料的要点总结与出处。
- \`index.md\`：知识索引，由知屿自动汇总。
- \`log.md\`：整理日志，由知屿自动追加。

## 写作原则

1. **忠于来源。** 只写资料里出现过的事实，不补常识，不编造数据。
2. **用自己的话。** 提炼而不是复制，长段落要压缩成可复用的结论。
3. **一件事一条。** 每条笔记只讲一个概念或一个对象，标题就是它的名字。
4. **优先合并。** 已有同名或同义条目时，在原条目上补充，不要重复创建。
5. **建立连接。** 用 \`[[条目名]]\` 连接相关概念，让知识之间可以互相看见。
6. **保持克制。** 正文通常 300–800 字，先写清楚，再写漂亮。
`;

const INDEX_SEED = `# 知识索引

> 由知屿根据知识库内容自动汇总。

_还没有知识条目。把资料放进收件箱，整理后会在这里出现。_
`;

const LOG_SEED = `# 整理日志

`;

class Vault {
  constructor(root) {
    this.root = path.resolve(root);
    this.name = path.basename(this.root);
    this.cache = new Map();
    this.watcher = null;
    this.watchTimer = null;
  }

  async init({ seed = false } = {}) {
    const stat = await fsp.stat(this.root).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      fail('这个文件夹不存在，可能已经被移动或删除');
    }
    await fsp.mkdir(path.join(this.root, 'raw'), { recursive: true });
    await fsp.mkdir(path.join(this.root, 'wiki', 'concepts'), { recursive: true });
    await fsp.mkdir(path.join(this.root, 'wiki', 'entities'), { recursive: true });
    await fsp.mkdir(path.join(this.root, 'wiki', 'sources'), { recursive: true });
    await fsp.mkdir(path.join(this.root, 'wiki', 'notes'), { recursive: true });
    await fsp.mkdir(path.join(this.root, '.zhiyu'), { recursive: true });

    await this.ensureFile('AGENTS.md', AGENTS_SEED);
    await this.ensureFile('index.md', INDEX_SEED);
    await this.ensureFile('log.md', LOG_SEED);

    if (seed) {
      const rawFiles = await this.listMarkdown('raw');
      const wikiFiles = await this.listMarkdown('wiki');
      if (!rawFiles.length && !wikiFiles.length) {
        await this.importText({
          title: '欢迎来到知屿',
          content: `这里的每一条知识，都从一份原始资料开始。

把网页链接、零散想法或已有的 Markdown 文件放进收件箱。选中它们，交给 AI 按你的规则整理成概念、实体和来源摘要。

## 三个小建议

- **先预览，再写入。** 每次整理都会展示将要新增或更新的条目。
- **让笔记互相认识。** 用 [[双向链接]] 把相关的概念连起来。
- **随时可以回到过去。** 每次整理都会在 Git 里留下一个快照。`,
          source: '知屿',
          tags: ['开始'],
        });
      }
    }

    this.cache.clear();
    return this.info();
  }

  async ensureFile(rel, content) {
    const abs = resolveInside(this.root, rel);
    try {
      await fsp.access(abs);
    } catch {
      await fsp.writeFile(abs, content, 'utf8');
    }
  }

  resolveForWrite(rel) {
    return resolveInside(this.root, rel);
  }

  info() {
    return {
      path: this.root,
      name: this.name,
    };
  }

  typeFromPath(rel) {
    const normalized = rel.replace(/\\/g, '/');
    if (normalized.startsWith('raw/')) return 'raw';
    if (normalized.startsWith('wiki/concepts/')) return 'concept';
    if (normalized.startsWith('wiki/entities/')) return 'entity';
    if (normalized.startsWith('wiki/sources/')) return 'source';
    if (normalized.startsWith('wiki/notes/')) return 'note';
    if (normalized.startsWith('wiki/')) return 'note';
    return 'system';
  }

  async walk(dirAbs) {
    const out = [];
    let entries;
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const abs = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await this.walk(abs)));
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        out.push(abs);
      }
    }
    return out;
  }

  async listMarkdown(folder) {
    const abs = path.join(this.root, folder);
    return this.walk(abs);
  }

  cleanFrontmatter(data) {
    const ordered = {};
    const keys = [
      'title',
      'type',
      'status',
      'created',
      'updated',
      'processed_at',
      'source',
      'author',
      'tags',
      'aliases',
      'sources',
      'wiki',
    ];
    for (const key of keys) {
      if (data[key] === undefined || data[key] === null) continue;
      const value = data[key];
      ordered[key] = value instanceof Date ? isoDate(value) : value;
    }
    for (const [key, value] of Object.entries(data)) {
      if (key in ordered || value === undefined || value === null) continue;
      ordered[key] = value instanceof Date ? isoDate(value) : value;
    }
    return ordered;
  }

  async parseFile(abs) {
    const rel = path.relative(this.root, abs).replace(/\\/g, '/');
    const stat = await fsp.stat(abs);
    const cached = this.cache.get(abs);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached;
    }
    const large = stat.size > LARGE_FILE_BYTES;
    const text = large
      ? await readFilePrefix(abs, LARGE_PREFIX_BYTES)
      : await fsp.readFile(abs, 'utf8');
    let parsed;
    try {
      parsed = matter(text);
    } catch {
      parsed = { data: {}, content: text };
    }
    const data = parsed.data || {};
    let body = parsed.content || '';
    const truncated = large || body.length > MAX_PREVIEW_CHARS;
    if (body.length > MAX_PREVIEW_CHARS) {
      body = body.slice(0, MAX_PREVIEW_CHARS);
    }
    const type = this.typeFromPath(rel);
    const title =
      String(data.title || '').trim() || titleFromBody(body) || path.basename(abs, path.extname(abs));
    const plain = stripMarkdown(body);
    const cjkCount = (plain.match(/[\u3400-\u9fff]/g) || []).length;
    const latinWords = (plain.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
    const totalWords = cjkCount + latinWords;
    const created = isoDate(data.created, stat.birthtime.toISOString().slice(0, 10));
    const updated = isoDate(data.updated, stat.mtime.toISOString());
    const meta = {
      path: rel,
      title,
      type,
      typeLabel: TYPE_LABELS[type] || '笔记',
      tags: asStringArray(data.tags),
      aliases: asStringArray(data.aliases),
      created,
      updated,
      excerpt: excerptOf(body, 160),
      links: parseWikiLinks(body),
      status: data.status ? String(data.status) : type === 'raw' ? 'inbox' : '',
      source: data.source ? String(data.source) : '',
      author: data.author ? String(data.author) : '',
      processedAt: data.processed_at ? String(data.processed_at) : '',
      wikiPaths: asStringArray(data.wiki),
      wordCount: totalWords,
      readingMinutes: Math.max(1, Math.ceil(cjkCount / 400 + latinWords / 220)),
      size: stat.size,
      truncated,
    };
    const entry = { abs, rel, meta, body, data, mtimeMs: stat.mtimeMs, size: stat.size };
    this.cache.set(abs, entry);
    return entry;
  }

  async listNotes() {
    const files = [...(await this.listMarkdown('raw')), ...(await this.listMarkdown('wiki'))];
    const entries = await Promise.all(files.map((abs) => this.parseFile(abs).catch(() => null)));
    const notes = entries.filter(Boolean).map((entry) => entry.meta);
    notes.sort((a, b) => {
      if (a.type === 'raw' && b.type !== 'raw') return -1;
      if (b.type === 'raw' && a.type !== 'raw') return 1;
      return String(b.updated).localeCompare(String(a.updated));
    });
    return notes;
  }

  async readNote(relPath) {
    const abs = resolveInside(this.root, relPath);
    if (!/\.(md|markdown)$/i.test(abs)) {
      fail('只能打开 Markdown 文件');
    }
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) {
      fail('这条笔记不存在，可能已经被移动或删除');
    }
    const entry = await this.parseFile(abs);
    return { ...entry.meta, body: entry.body, data: entry.data };
  }

  async writeMarkdown(abs, data, body) {
    const normalizedBody = String(body || '').replace(/\s+$/, '');
    const text = matter.stringify(normalizedBody ? `${normalizedBody}\n` : '', this.cleanFrontmatter(data));
    await fsp.writeFile(abs, text, 'utf8');
  }

  async saveNote(relPath, patch = {}) {
    const abs = resolveInside(this.root, relPath);
    const existing = await this.readNote(relPath);
    if (existing.truncated || existing.size > LARGE_FILE_BYTES) {
      fail('这条笔记过大，已设为只读预览；请在文件夹中直接编辑，或拆分成多条笔记。');
    }
    if (existing.type === 'system') {
      fail('系统文件请使用专门的保存方式');
    }
    const data = { ...existing.data };
    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (!title) fail('标题不能为空');
      data.title = title.slice(0, 120);
    }
    if (patch.tags !== undefined) data.tags = asStringArray(patch.tags);
    if (patch.aliases !== undefined) data.aliases = asStringArray(patch.aliases);
    data.created = data.created || existing.created;
    data.updated = nowIso();
    data.type = data.type || existing.type;
    const body = patch.body !== undefined ? String(patch.body) : existing.body;
    await this.writeMarkdown(abs, data, body);
    this.cache.delete(abs);
    return this.readNote(relPath);
  }

  async saveSystemFile(relPath, body) {
    if (!['AGENTS.md', 'index.md', 'log.md'].includes(relPath)) {
      fail('这个系统文件不支持编辑');
    }
    const abs = resolveInside(this.root, relPath);
    await fsp.writeFile(abs, String(body || '').replace(/\s+$/, '') + '\n', 'utf8');
    this.cache.delete(abs);
    return this.readNote(relPath);
  }

  async uniquePath(folder, slug) {
    let rel = `${folder}/${slug}.md`;
    let index = 2;
    while (true) {
      const abs = resolveInside(this.root, rel);
      try {
        await fsp.access(abs);
        rel = `${folder}/${slug}-${index}.md`;
        index += 1;
      } catch {
        return rel;
      }
    }
  }

  async createNote({ type = 'concept', title, body = '', tags = [] } = {}) {
    if (!FOLDERS[type]) fail('不支持的笔记类型');
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) fail('请先给这条笔记起一个名字');
    const folder = `wiki/${FOLDERS[type]}`;
    const rel = await this.uniquePath(folder, slugify(cleanTitle));
    const abs = resolveInside(this.root, rel);
    const stamp = nowIso();
    await this.writeMarkdown(abs, {
      title: cleanTitle.slice(0, 120),
      type,
      created: stamp,
      updated: stamp,
      tags: asStringArray(tags),
    }, body);
    this.cache.delete(abs);
    return this.readNote(rel);
  }

  async importText({
    title,
    content,
    source = '',
    author = '',
    kind = 'text',
    tags = [],
  } = {}) {
    const text = String(content || '').trim();
    if (!text) fail('资料内容不能为空');
    const cleanTitle =
      String(title || '').trim() ||
      titleFromBody(text) ||
      text.split('\n').find((line) => line.trim())?.trim().slice(0, 60) ||
      '未命名资料';
    const stamp = localDateStamp();
    const rel = await this.uniquePath('raw', `${stamp}-${slugify(cleanTitle)}`);
    const abs = resolveInside(this.root, rel);
    const now = nowIso();
    await this.writeMarkdown(abs, {
      title: cleanTitle.slice(0, 160),
      type: 'raw',
      status: 'inbox',
      created: now,
      updated: now,
      source: String(source || '').trim(),
      author: String(author || '').trim(),
      tags: asStringArray(tags),
      kind,
    }, text);
    this.cache.delete(abs);
    return this.readNote(rel);
  }

  async importFile(filePath) {
    const abs = path.resolve(String(filePath || ''));
    const ext = path.extname(abs).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new UserError('支持 Markdown、TXT、PDF、Word (.docx) 和 HTML 文件');
    }
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) throw new UserError('找不到这个文件');
    if (['.pdf', '.docx', '.html', '.htm'].includes(ext)) {
      const extracted = await extractDocument(abs);
      return this.importText({
        title: extracted.title || path.basename(abs, ext),
        content: extracted.body,
        source: abs,
        author: extracted.author || '',
        kind: 'file',
      });
    }
    const text = decodeText(await fsp.readFile(abs));
    if (ext === '.txt') {
      return this.importText({
        title: path.basename(abs, ext),
        content: text,
        source: abs,
        kind: 'file',
      });
    }
    let parsed;
    try {
      parsed = matter(text);
    } catch {
      parsed = { data: {}, content: text };
    }
    return this.importText({
      title: parsed.data?.title || path.basename(abs, ext),
      content: parsed.content || text,
      source: abs,
      author: parsed.data?.author || '',
      tags: asStringArray(parsed.data?.tags),
      kind: 'file',
    });
  }

  async importFiles(filePaths = []) {
    const imported = [];
    const failed = [];
    for (const filePath of filePaths) {
      try {
        imported.push(await this.importFile(filePath));
      } catch (error) {
        failed.push({ path: filePath, message: error.message || '导入失败' });
      }
    }
    return { imported, failed };
  }

  async updateRawStatus(relPath, { status, wikiPaths = [] } = {}) {
    const abs = resolveInside(this.root, relPath);
    const existing = await this.readNote(relPath);
    if (existing.truncated || existing.size > LARGE_FILE_BYTES) {
      fail('这份资料过大，暂时不能在应用内整理；请先拆分文件。');
    }
    const data = { ...existing.data };
    data.status = status || data.status || 'processed';
    if (status === 'processed') data.processed_at = nowIso();
    if (wikiPaths.length) {
      data.wiki = [...new Set([...asStringArray(data.wiki), ...wikiPaths])];
    }
    data.updated = nowIso();
    await this.writeMarkdown(abs, data, existing.body);
    this.cache.delete(abs);
    return this.readNote(relPath);
  }

  async promoteRaw(relPath) {
    const raw = await this.readNote(relPath);
    if (raw.type !== 'raw') fail('只有收件箱里的资料可以直接入库');
    if (raw.truncated || raw.size > LARGE_FILE_BYTES) {
      fail('这份资料过大，暂时不能在应用内直接入库；请先拆分文件。');
    }
    const candidates = (await this.listNotes()).filter(
      (note) =>
        note.type === 'source' && normalizeTitle(note.title) === normalizeTitle(raw.title),
    );
    let existing = null;
    for (const candidate of candidates) {
      const detail = await this.readNote(candidate.path).catch(() => null);
      if (detail && asStringArray(detail.data.sources).includes(raw.path)) {
        existing = candidate;
        break;
      }
    }
    if (existing) {
      await this.updateRawStatus(raw.path, { status: 'processed', wikiPaths: [existing.path] });
      await this.rebuildIndex();
      return {
        path: existing.path,
        title: existing.title,
        created: false,
        notes: await this.listNotes(),
        stats: await this.stats(),
      };
    }
    const pagePath = await this.uniquePath('wiki/sources', slugify(raw.title));
    const abs = resolveInside(this.root, pagePath);
    const stamp = nowIso();
    const data = {
      title: raw.title,
      type: 'source',
      created: stamp,
      updated: stamp,
      tags: asStringArray(raw.tags),
      aliases: asStringArray(raw.aliases),
      source: raw.source || raw.path,
      sources: [raw.path],
    };
    await this.writeMarkdown(abs, data, raw.body);
    this.cache.delete(abs);
    await this.updateRawStatus(raw.path, { status: 'processed', wikiPaths: [pagePath] });
    await this.appendLog(`直接入库《${raw.title}》`);
    await this.rebuildIndex();
    return {
      path: pagePath,
      title: raw.title,
      created: true,
      notes: await this.listNotes(),
      stats: await this.stats(),
    };
  }

  async rebuildIndex() {    const notes = await this.listNotes();
    const groups = [
      { type: 'concept', title: '概念' },
      { type: 'entity', title: '实体' },
      { type: 'source', title: '来源' },
      { type: 'note', title: '笔记' },
    ];
    const lines = [
      '# 知识索引',
      '',
      `> 由知屿根据知识库内容自动汇总 · 更新于 ${localDateTime()}`,
      '',
    ];
    let total = 0;
    for (const group of groups) {
      const items = notes.filter((note) => note.type === group.type);
      if (!items.length) continue;
      total += items.length;
      lines.push(`## ${group.title} · ${items.length}`, '');
      for (const item of items) {
        const excerpt = item.excerpt.replace(/\|/g, '／');
        const link = `[[${item.path.replace(/\.md$/i, '')}|${item.title}]]`;
        lines.push(`- ${link} — ${excerpt}`);
      }
      lines.push('');
    }
    if (!total) {
      lines.push('_还没有知识条目。把资料放进收件箱，整理后会在这里出现。_', '');
    }
    const abs = resolveInside(this.root, 'index.md');
    await fsp.writeFile(abs, `${lines.join('\n').trim()}\n`, 'utf8');
    this.cache.delete(abs);
  }

  async appendLog(text) {
    const abs = resolveInside(this.root, 'log.md');
    let existing = '';
    try {
      existing = await fsp.readFile(abs, 'utf8');
    } catch {
      existing = LOG_SEED;
    }
    const line = `- ${localDateTime()} · ${String(text || '').replace(/\s+/g, ' ').trim()}`;
    const next = `${existing.trimEnd()}\n${line}\n`;
    await fsp.writeFile(abs, next, 'utf8');
    this.cache.delete(abs);
  }

  async stats() {
    const notes = await this.listNotes();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      inbox: notes.filter((note) => note.type === 'raw' && note.status !== 'processed').length,
      total: notes.filter((note) => note.type !== 'raw').length,
      raw: notes.filter((note) => note.type === 'raw').length,
      week: notes.filter(
        (note) => note.type !== 'raw' && new Date(note.updated).getTime() >= weekAgo,
      ).length,
    };
  }

  async search(query, limit = 6, { scope = 'all' } = {}) {
    const text = String(query || '').trim();
    if (!text) return [];
    const tokens = queryTokens(text);
    if (!tokens.length) return [];
    const notes = await this.listNotes();
    const filtered = notes.filter((note) => {
      if (scope === 'wiki') return note.type !== 'raw';
      if (scope === 'raw') return note.type === 'raw';
      return true;
    });
    const scored = [];
    for (const note of filtered) {
      const entry = await this.parseFile(resolveInside(this.root, note.path)).catch(() => null);
      if (!entry) continue;
      const title = note.title.toLowerCase();
      const body = entry.body.toLowerCase();
      const aliases = note.aliases.join(' ').toLowerCase();
      const tags = note.tags.join(' ').toLowerCase();
      let score = 0;
      if (title.includes(text.toLowerCase())) score += 24;
      for (const token of tokens) {
        if (title.includes(token)) score += 7;
        if (aliases.includes(token)) score += 6;
        if (tags.includes(token)) score += 4;
        let count = 0;
        let pos = body.indexOf(token);
        while (pos !== -1 && count < 6) {
          count += 1;
          pos = body.indexOf(token, pos + token.length);
        }
        score += count;
      }
      if (note.type === 'raw') score *= 0.8;
      if (score > 0) {
        scored.push({ ...note, body: truncate(entry.body, 2600), score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, limit));
  }

  async loadChat() {
    const store = await this.readChatStore();
    return store.sessions.find((session) => session.id === store.activeId)?.messages || [];
  }

  async saveChat(messages) {
    const store = await this.readChatStore();
    let session = store.sessions.find((item) => item.id === store.activeId);
    if (!session) {
      session = {
        id: crypto.randomUUID(),
        title: '新对话',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        messages: [],
      };
      store.sessions.unshift(session);
      store.activeId = session.id;
    }
    session.messages = Array.isArray(messages) ? messages.slice(-200) : [];
    session.summaryCount = Math.min(
      Math.max(0, Number(session.summaryCount) || 0),
      session.messages.length,
    );
    session.updatedAt = nowIso();
    if (!session.title || session.title === '新对话') {
      session.title = chatTitleFromMessages(session.messages);
    }
    await this.writeChatStore(store);
  }

  async clearChat() {
    const store = await this.readChatStore();
    const session = store.sessions.find((item) => item.id === store.activeId);
    if (!session) return;
    session.messages = [];
    session.title = '新对话';
    session.updatedAt = nowIso();
    await this.writeChatStore(store);
  }

  chatStorePath() {
    return path.join(this.root, '.zhiyu', 'chats.json');
  }

  async readChatStore() {
    const dir = path.join(this.root, '.zhiyu');
    await fsp.mkdir(dir, { recursive: true });
    try {
      const parsed = JSON.parse(await fsp.readFile(this.chatStorePath(), 'utf8'));
      if (parsed && Array.isArray(parsed.sessions)) {
        const sessions = parsed.sessions
          .filter((session) => session && typeof session.id === 'string')
          .map((session) => ({
            id: session.id,
            title: String(session.title || '新对话').slice(0, 80),
            createdAt: session.createdAt || nowIso(),
            updatedAt: session.updatedAt || session.createdAt || nowIso(),
            messages: Array.isArray(session.messages) ? session.messages : [],
            summary: typeof session.summary === 'string' ? session.summary : '',
            summaryCount: Math.max(0, Number(session.summaryCount) || 0),
          }));
        const activeId = sessions.some((session) => session.id === parsed.activeId)
          ? parsed.activeId
          : sessions[0]?.id || null;
        return { version: 1, activeId, sessions };
      }
    } catch {
      // fall through to legacy migration
    }

    try {
      const legacy = JSON.parse(await fsp.readFile(path.join(dir, 'chat.json'), 'utf8'));
      if (Array.isArray(legacy) && legacy.length) {
        const createdAt = legacy[0]?.createdAt || nowIso();
        const session = {
          id: crypto.randomUUID(),
          title: chatTitleFromMessages(legacy),
          createdAt,
          updatedAt: legacy[legacy.length - 1]?.createdAt || nowIso(),
          messages: legacy,
        };
        const store = { version: 1, activeId: session.id, sessions: [session] };
        await this.writeChatStore(store);
        return store;
      }
    } catch {
      // no legacy chat
    }
    return { version: 1, activeId: null, sessions: [] };
  }

  async writeChatStore(store) {
    const dir = path.join(this.root, '.zhiyu');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(this.chatStorePath(), JSON.stringify(store, null, 2), 'utf8');
  }

  chatMeta(session) {
    const last = [...session.messages].reverse().find((message) => message?.content);
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      preview: last ? truncate(stripMarkdown(String(last.content || '')), 80) : '',
      summary: session.summary || '',
      summaryCount: Math.min(
        Math.max(0, Number(session.summaryCount) || 0),
        session.messages.length,
      ),
    };
  }

  async chatList() {
    const store = await this.readChatStore();
    const sessions = [...store.sessions]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((session) => this.chatMeta(session));
    return { sessions, activeId: store.activeId };
  }

  async chatGet(id) {
    const store = await this.readChatStore();
    return store.sessions.find((session) => session.id === id) || null;
  }

  async chatCreate(title = '新对话') {
    const store = await this.readChatStore();
    const stamp = nowIso();
    const session = {
      id: crypto.randomUUID(),
      title: String(title || '新对话').slice(0, 80),
      createdAt: stamp,
      updatedAt: stamp,
      messages: [],
      summary: '',
      summaryCount: 0,
    };
    store.sessions.unshift(session);
    store.activeId = session.id;
    await this.writeChatStore(store);
    return session;
  }

  async chatSelect(id) {
    const store = await this.readChatStore();
    const session = store.sessions.find((item) => item.id === id);
    if (!session) fail('这条对话不存在');
    store.activeId = id;
    await this.writeChatStore(store);
    return session;
  }

  async chatRename(id, title) {
    const store = await this.readChatStore();
    const session = store.sessions.find((item) => item.id === id);
    if (!session) fail('这条对话不存在');
    const next = String(title || '').trim();
    session.title = (next || '新对话').slice(0, 80);
    session.updatedAt = nowIso();
    await this.writeChatStore(store);
    return this.chatMeta(session);
  }

  async chatDelete(id) {
    const store = await this.readChatStore();
    store.sessions = store.sessions.filter((session) => session.id !== id);
    if (store.activeId === id) {
      store.activeId = store.sessions[0]?.id || null;
    }
    await this.writeChatStore(store);
    return {
      sessions: store.sessions.map((session) => this.chatMeta(session)),
      activeId: store.activeId,
      messages: store.sessions.find((session) => session.id === store.activeId)?.messages || [],
    };
  }

  async chatClear(id) {
    const store = await this.readChatStore();
    const session = store.sessions.find((item) => item.id === id);
    if (!session) fail('这条对话不存在');
    session.messages = [];
    session.title = '新对话';
    session.summary = '';
    session.summaryCount = 0;
    session.updatedAt = nowIso();
    await this.writeChatStore(store);
    return this.chatMeta(session);
  }

  async chatSetSummary(id, summary, summaryCount) {
    const store = await this.readChatStore();
    const session = store.sessions.find((item) => item.id === id);
    if (!session) fail('这条对话不存在');
    session.summary = String(summary || '').slice(0, 4000);
    session.summaryCount = Math.min(
      session.messages.length,
      Math.max(0, Number(summaryCount) || 0),
    );
    session.updatedAt = nowIso();
    await this.writeChatStore(store);
    return session;
  }

  async chatSaveMessages(id, messages, titleHint) {
    const store = await this.readChatStore();
    let session = store.sessions.find((item) => item.id === id);
    if (!session) {
      session = {
        id,
        title: '新对话',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        messages: [],
      };
      store.sessions.unshift(session);
    }
    session.messages = Array.isArray(messages) ? messages.slice(-200) : [];
    session.summaryCount = Math.min(
      Math.max(0, Number(session.summaryCount) || 0),
      session.messages.length,
    );
    session.updatedAt = nowIso();
    if ((!session.title || session.title === '新对话') && titleHint) {
      session.title = String(titleHint).slice(0, 60);
    } else if (!session.title || session.title === '新对话') {
      session.title = chatTitleFromMessages(session.messages);
    }
    store.activeId = id;
    await this.writeChatStore(store);
    return this.chatMeta(session);
  }

  trashPaths() {
    const dir = path.join(this.root, '.zhiyu', 'trash');
    return { dir, indexPath: path.join(this.root, '.zhiyu', 'trash.json') };
  }

  async readTrashIndex() {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.trashPaths().indexPath, 'utf8'));
      return Array.isArray(parsed?.entries) ? parsed.entries : [];
    } catch {
      return [];
    }
  }

  async writeTrashIndex(entries) {
    const dir = path.join(this.root, '.zhiyu');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(this.trashPaths().indexPath, JSON.stringify({ entries }, null, 2), 'utf8');
  }

  async trashList() {
    const entries = await this.readTrashIndex();
    return entries
      .filter((entry) => fs.existsSync(path.join(this.trashPaths().dir, entry.fileName)))
      .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  }

  async trashCount() {
    return (await this.trashList()).length;
  }

  async moveToTrash(relPath) {
    const note = await this.readNote(relPath);
    if (note.type === 'system') fail('系统文件不能删除');
    const { dir } = this.trashPaths();
    await fsp.mkdir(dir, { recursive: true });
    const id = crypto.randomUUID();
    const fileName = `${id}.md`;
    const source = resolveInside(this.root, relPath);
    const target = path.join(dir, fileName);
    try {
      await fsp.rename(source, target);
    } catch (error) {
      if (error.code === 'EXDEV') {
        await fsp.copyFile(source, target);
        await fsp.unlink(source);
      } else {
        throw error;
      }
    }
    const entries = await this.readTrashIndex();
    const entry = {
      id,
      title: note.title,
      type: note.type,
      originalPath: relPath,
      fileName,
      deletedAt: nowIso(),
    };
    entries.unshift(entry);
    await this.writeTrashIndex(entries);
    this.cache.delete(source);
    await this.rebuildIndex();
    return entry;
  }

  async restoreTrash(id) {
    const entries = await this.readTrashIndex();
    const entry = entries.find((item) => item.id === id);
    if (!entry) fail('回收站里没有这条笔记');
    const source = path.join(this.trashPaths().dir, entry.fileName);
    if (!fs.existsSync(source)) fail('回收站文件已经不存在');
    let targetRel = entry.originalPath;
    let target = resolveInside(this.root, targetRel);
    if (fs.existsSync(target)) {
      const parsed = path.parse(targetRel);
      let index = 1;
      do {
        targetRel = path.posix.join(parsed.dir.replace(/\\/g, '/'), `${parsed.name}-restored-${index}${parsed.ext}`);
        target = resolveInside(this.root, targetRel);
        index += 1;
      } while (fs.existsSync(target) && index < 100);
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      await fsp.rename(source, target);
    } catch (error) {
      if (error.code === 'EXDEV') {
        await fsp.copyFile(source, target);
        await fsp.unlink(source);
      } else {
        throw error;
      }
    }
    await this.writeTrashIndex(entries.filter((item) => item.id !== id));
    this.cache.delete(target);
    await this.rebuildIndex();
    return { path: targetRel, title: entry.title };
  }

  async deleteTrash(id) {
    const entries = await this.readTrashIndex();
    const entry = entries.find((item) => item.id === id);
    if (!entry) fail('回收站里没有这条笔记');
    await fsp.unlink(path.join(this.trashPaths().dir, entry.fileName)).catch(() => {});
    await this.writeTrashIndex(entries.filter((item) => item.id !== id));
  }

  async emptyTrash() {
    const entries = await this.readTrashIndex();
    for (const entry of entries) {
      await fsp.unlink(path.join(this.trashPaths().dir, entry.fileName)).catch(() => {});
    }
    await this.writeTrashIndex([]);
  }

  startWatching(onChange) {
    this.stopWatching();
    const targets = [
      path.join(this.root, 'raw'),
      path.join(this.root, 'wiki'),
      path.join(this.root, 'AGENTS.md'),
      path.join(this.root, 'index.md'),
      path.join(this.root, 'log.md'),
    ];
    this.watcher = chokidar.watch(targets, {
      ignoreInitial: true,
      depth: 8,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 60 },
      ignored: (target) => /[\\/](\.git|\.zhiyu)([\\/]|$)/.test(target),
    });
    const notify = (event, target) => {
      if (target) this.cache.delete(path.resolve(target));
      if (this.watchTimer) clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => {
        onChange?.({ event, path: target ? path.relative(this.root, target).replace(/\\/g, '/') : '' });
      }, 320);
    };
    this.watcher.on('add', (target) => notify('add', target));
    this.watcher.on('change', (target) => notify('change', target));
    this.watcher.on('unlink', (target) => notify('unlink', target));
    return this.watcher;
  }

  stopWatching() {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = null;
    }
    if (this.watcher) {
      this.watcher.close().catch(() => {});
      this.watcher = null;
    }
  }
}

module.exports = { Vault, TYPE_LABELS, FOLDERS };
