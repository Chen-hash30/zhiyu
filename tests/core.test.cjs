const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../electron/lib/vault.cjs');
const git = require('../electron/lib/git.cjs');
const {
  resolveInside,
  slugify,
  parseWikiLinks,
  queryTokens,
  stripMarkdown,
} = require('../electron/lib/util.cjs');

test('路径必须留在知识库内', () => {
  const root = path.resolve('C:/demo/vault');
  assert.equal(resolveInside(root, 'raw/a.md'), path.join(root, 'raw', 'a.md'));
  assert.throws(() => resolveInside(root, '../secret.txt'));
  assert.throws(() => resolveInside(root, 'C:/Windows/win.ini'));
});

test('标题会生成安全文件名', () => {
  assert.equal(slugify('  Hello / World  '), 'Hello-World');
  assert.equal(slugify('CON'), 'CON-note');
  assert.ok(slugify('第二大脑：连接与复利').length > 4);
});

test('双向链接与中文检索词', () => {
  assert.deepEqual(parseWikiLinks('看 [[概念|别名]] 和 [[实体]]'), ['概念', '实体']);
  const tokens = queryTokens('智能体记忆');
  assert.ok(tokens.includes('智能'));
  assert.ok(tokens.includes('记忆'));
  assert.equal(stripMarkdown('# 标题\n\n**重点** [[链接]]'), '标题 重点 链接');
});

test('知识库完整生命周期', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zhiyu-test-'));
  try {
    const vault = new Vault(root);
    await vault.init({ seed: true });
    assert.ok(fs.existsSync(path.join(root, 'AGENTS.md')));
    assert.ok(fs.existsSync(path.join(root, 'wiki', 'concepts')));
    let notes = await vault.listNotes();
    assert.ok(notes.some((note) => note.title === '欢迎来到知屿'));

    const raw = await vault.importText({
      title: '一段测试资料',
      content: '# 测试资料\n\n智能体记忆需要分层设计。参考 [[第二大脑]]。',
      source: 'https://example.com',
    });
    assert.equal(raw.type, 'raw');
    assert.equal(raw.status, 'inbox');

    const concept = await vault.createNote({
      type: 'concept',
      title: '测试概念',
      body: '这是一个用于测试的概念，和 [[第二大脑]] 有关。',
      tags: ['测试'],
    });
    assert.equal(concept.path, 'wiki/concepts/测试概念.md');

    const saved = await vault.saveNote(concept.path, {
      title: '测试概念',
      body: '更新后的正文，涉及智能体记忆与知识复利。',
      tags: ['测试', '知识管理'],
    });
    assert.equal(saved.tags.length, 2);

    await vault.updateRawStatus(raw.path, {
      status: 'processed',
      wikiPaths: [concept.path],
    });
    notes = await vault.listNotes();
    assert.equal(notes.find((note) => note.path === raw.path).status, 'processed');

    await vault.rebuildIndex();
    const index = await vault.readNote('index.md');
    assert.ok(index.body.includes('测试概念'));

    const hits = await vault.search('智能体记忆', 5);
    assert.ok(hits.length >= 1);

    await vault.saveSystemFile('AGENTS.md', '# 自定义规则\n\n- 保持简洁。\n');
    const agents = await vault.readNote('AGENTS.md');
    assert.ok(agents.body.includes('自定义规则'));

    const key = 'chat-message';
    await vault.saveChat([{ id: key, role: 'user', content: '你好' }]);
    const chat = await vault.loadChat();
    assert.equal(chat[0].content, '你好');
    await vault.clearChat();
    assert.deepEqual(await vault.loadChat(), []);

    const firstSession = await vault.chatCreate('第一段对话');
    const secondSession = await vault.chatCreate('第二段对话');
    assert.equal((await vault.chatList()).activeId, secondSession.id);
    await vault.chatSaveMessages(firstSession.id, [
      { id: 'm1', role: 'user', content: '收件箱里有什么？' },
      { id: 'm2', role: 'assistant', content: '有两条资料。' },
    ]);
    await vault.chatSelect(firstSession.id);
    assert.equal((await vault.chatList()).activeId, firstSession.id);
    await vault.chatRename(firstSession.id, '收件箱盘点');
    assert.equal((await vault.chatGet(firstSession.id)).title, '收件箱盘点');
    const removed = await vault.chatDelete(secondSession.id);
    assert.ok(!removed.sessions.some((session) => session.id === secondSession.id));
    await vault.chatClear(firstSession.id);
    assert.deepEqual((await vault.chatGet(firstSession.id)).messages, []);
    await vault.chatSaveMessages(firstSession.id, [
      { id: 's1', role: 'user', content: '第一条' },
      { id: 's2', role: 'assistant', content: '第二条' },
      { id: 's3', role: 'user', content: '第三条' },
    ]);
    await vault.chatSetSummary(firstSession.id, '这是压缩后的摘要', 2);
    const compressedMeta = (await vault.chatList()).sessions.find(
      (session) => session.id === firstSession.id,
    );
    assert.equal(compressedMeta.summary, '这是压缩后的摘要');
    assert.equal(compressedMeta.summaryCount, 2);

    const trashNote = await vault.createNote({
      type: 'note',
      title: '准备删除的笔记',
      body: '这条笔记会被放进回收站。',
    });
    const trashed = await vault.moveToTrash(trashNote.path);
    assert.ok((await vault.trashList()).some((entry) => entry.id === trashed.id));
    await assert.rejects(() => vault.readNote(trashNote.path));
    const restored = await vault.restoreTrash(trashed.id);
    assert.equal(restored.title, '准备删除的笔记');
    assert.ok((await vault.readNote(restored.path)).body.includes('回收站'));
    await vault.moveToTrash(restored.path);
    const secondTrash = await vault.trashList();
    await vault.deleteTrash(secondTrash[0].id);
    assert.equal((await vault.trashList()).length, 0);

    const gitReady = await git.init(root);
    if (gitReady) {
      const status = await git.status(root);
      assert.equal(status.isRepo, true);
      const hash = await git.commit(root, '测试快照');
      assert.ok(hash === null || /^[0-9a-f]{7,40}$/.test(hash));
      const history = await git.history(root);
      assert.ok(Array.isArray(history));
      const snapshotDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zhiyu-bundle-'));
      try {
        const bundleFile = await git.bundle(root, snapshotDir);
        assert.ok(bundleFile && fs.existsSync(bundleFile));
        assert.ok(fs.statSync(bundleFile).size > 0);
      } finally {
        await fsp.rm(snapshotDir, { recursive: true, force: true });
      }
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('导入文件不再受 5MB 限制', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zhiyu-big-'));
  const bigFile = path.join(os.tmpdir(), `zhiyu-big-${Date.now()}.md`);
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(bigFile, `# 大文件\n\n${'内容'.repeat(3 * 1024 * 1024)}`, 'utf8');
    const vault = new Vault(root);
    await vault.init({ seed: false });
    const note = await vault.importFile(bigFile);
    assert.equal(note.type, 'raw');
    assert.ok(note.size > 5 * 1024 * 1024);
    assert.equal(note.truncated, true);
    assert.ok(note.body.length <= 120000);
    const stored = vault.resolveForWrite(note.path);
    assert.ok(fs.statSync(stored).size > 5 * 1024 * 1024);
    await assert.rejects(() => vault.saveNote(note.path, { body: '不应覆盖大文件' }));
  } finally {
    await fsp.rm(bigFile, { force: true });
    await fsp.rm(root, { recursive: true, force: true });
  }
});
