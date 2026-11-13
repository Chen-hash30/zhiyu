const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../electron/lib/vault.cjs');

test('原始资料可以不经过 AI 直接入库', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zhiyu-promote-'));
  try {
    const vault = new Vault(root);
    await vault.init({ seed: true });
    const raw = await vault.importText({
      title: '离线资料',
      content: '这是一份没有联网、没有调用模型的原始资料。\n\n它应该原样进入知识库。',
      source: '本地文件',
      tags: ['离线'],
    });
    const before = (await vault.listNotes()).filter((note) => note.type === 'source').length;
    const result = await vault.promoteRaw(raw.path);
    assert.equal(result.created, true);
    assert.ok(result.path.startsWith('wiki/sources/'));
    const source = await vault.readNote(result.path);
    assert.equal(source.type, 'source');
    assert.equal(source.title, '离线资料');
    assert.ok(source.body.includes('没有调用模型'));
    assert.deepEqual(source.data.sources, [raw.path]);
    const promotedRaw = await vault.readNote(raw.path);
    assert.equal(promotedRaw.status, 'processed');
    assert.deepEqual(promotedRaw.data.wiki, [result.path]);
    const log = await vault.readNote('log.md');
    assert.ok(log.body.includes('直接入库《离线资料》'));
    const index = await vault.readNote('index.md');
    assert.ok(index.body.includes('离线资料'));
    assert.equal(
      (await vault.listNotes()).filter((note) => note.type === 'source').length,
      before + 1,
    );

    const again = await vault.promoteRaw(raw.path);
    assert.equal(again.created, false);
    assert.equal(again.path, result.path);
    assert.equal(
      (await vault.listNotes()).filter((note) => note.type === 'source').length,
      before + 1,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});