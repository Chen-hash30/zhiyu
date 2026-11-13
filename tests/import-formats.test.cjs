const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../electron/lib/vault.cjs');

const FIXTURES = path.join(__dirname, 'fixtures');

test('可以直接导入 PDF、Word 和 HTML', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zhiyu-formats-'));
  try {
    const vault = new Vault(root);
    await vault.init({ seed: true });
    const outcome = await vault.importFiles([
      path.join(FIXTURES, 'sample.pdf'),
      path.join(FIXTURES, 'sample.docx'),
      path.join(FIXTURES, 'sample.html'),
    ]);
    assert.equal(outcome.failed.length, 0);
    assert.equal(outcome.imported.length, 3);
    const bySource = (name) =>
      outcome.imported.find((note) => note.source.endsWith(name));
    const pdf = bySource('sample.pdf');
    assert.ok(pdf);
    assert.equal(pdf.type, 'raw');
    assert.ok(pdf.body.includes('Hello PDF import'));
    const docx = bySource('sample.docx');
    assert.ok(docx);
    assert.ok(docx.body.includes('这是一份 Word 测试资料'));
    assert.ok(docx.body.includes('它应该自动变成 Markdown'));
    const html = bySource('sample.html');
    assert.ok(html);
    assert.equal(html.title, 'HTML 测试资料');
    assert.ok(html.body.includes('这是一段网页正文'));
    assert.ok(html.body.includes('第二段用于验证'));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('不支持的旧版 Word 会给出明确提示', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zhiyu-formats-'));
  const legacy = path.join(root, 'legacy.doc');
  await fsp.writeFile(legacy, 'old word');
  try {
    const vault = new Vault(root);
    await vault.init({ seed: true });
    await assert.rejects(vault.importFile(legacy), /支持 Markdown.*PDF.*Word/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
