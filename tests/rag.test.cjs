const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../electron/lib/vault.cjs');
const { RagService, chunkNote, DIMS } = require('../electron/lib/rag.cjs');

const KEYWORD_GROUPS = [
  ['写作', '压缩'],
  ['灌溉', '供水'],
  ['检索'],
];

function fakeEmbed(texts) {
  return texts.map((text) => {
    const vector = new Float32Array(DIMS);
    let hit = false;
    KEYWORD_GROUPS.forEach((group, index) => {
      if (group.some((keyword) => text.includes(keyword))) {
        vector[index] += 1;
        hit = true;
      }
    });
    if (!hit) vector[3] = 1;
    const length = Math.hypot(...vector);
    for (let index = 0; index < vector.length; index += 1) vector[index] /= length;
    return vector;
  });
}

test('长笔记会切成带标题的语义片段', () => {
  const paragraph = '这是一段关于知识管理的文字。'.repeat(100);
  const chunks = chunkNote({
    path: 'wiki/concepts/test.md',
    title: '测试笔记',
    type: 'concept',
    body: `${paragraph}\n\n第二段介绍写作和记录的关系。`,
  });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.length <= 60);
  assert.ok(chunks.every((chunk) => chunk.text.startsWith('《测试笔记》')));
  assert.ok(chunks.every((chunk) => chunk.text.length <= 760));
  assert.ok(chunks.some((chunk) => chunk.body.includes('第二段')));
});

test('建立索引、增量更新与混合检索', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zhiyu-rag-'));
  try {
    const vault = new Vault(root);
    await vault.init({ seed: true });
    const writing = await vault.createNote({
      type: 'concept',
      title: '写作方法',
      body: '写作是把想法变成可检验句子的过程。\n\n写作需要反复修改和压缩。',
    });
    const irrigation = await vault.createNote({
      type: 'concept',
      title: '灌溉制度',
      body: '灌溉制度决定什么时候给作物供水。\n\n灌溉需要结合降水与土壤。',
    });
    const raw = await vault.importText({
      title: '写作资料',
      content: '这份资料讨论写作和总结的关系。',
      source: 'test',
    });
    const calls = [];
    const rag = new RagService(vault, {
      embedFn: async (texts) => {
        calls.push(...texts);
        return fakeEmbed(texts);
      },
    });
    assert.equal((await rag.status()).ready, false);
    const progress = [];
    rag.onProgress = (item) => progress.push(item);
    const first = await rag.build();
    assert.equal(first.ready, true);
    assert.ok(first.notes >= 3);
    assert.ok(first.chunks > 0);
    assert.ok(progress.some((item) => item.phase === 'done'));
    await fsp.access(path.join(root, '.zhiyu', 'rag', 'index.json'));
    await fsp.access(path.join(root, '.zhiyu', 'rag', 'vectors.f32'));

    const writingHit = await rag.search('写作', 4);
    assert.ok(writingHit.some((hit) => hit.path === writing.path));
    const semanticHit = await rag.search('压缩', 4);
    assert.equal(semanticHit[0].path, writing.path);
    const irrigationHit = await rag.search('供水', 4);
    assert.equal(irrigationHit[0].path, irrigation.path);
    const wikiOnly = await rag.search('写作', 10, { scope: 'wiki' });
    assert.ok(wikiOnly.every((hit) => hit.type !== 'raw'));
    assert.ok(!wikiOnly.some((hit) => hit.path === raw.path));

    const before = calls.length;
    const second = await rag.build();
    assert.ok(second.ready);
    assert.equal(calls.length - before, 0);
    assert.ok(progress.some((item) => item.phase === 'embed' && item.reused > 0));

    const newNote = await vault.createNote({
      type: 'note',
      title: '检索笔记',
      body: '检索增强生成会先找相关资料再回答。',
    });
    const beforeNew = calls.length;
    await rag.build();
    assert.ok(calls.length > beforeNew);
    const newHit = await rag.search('检索', 4);
    assert.equal(newHit[0].path, newNote.path);

    const reloaded = new RagService(vault, { embedFn: fakeEmbed });
    const loadedHit = await reloaded.search('灌溉', 4);
    assert.equal(loadedHit[0].path, irrigation.path);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});