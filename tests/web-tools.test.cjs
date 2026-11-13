const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPublicUrl } = require('../electron/lib/webimport.cjs');
const { searchWeb } = require('../electron/lib/websearch.cjs');

test('外部网页工具拒绝本机和内网地址', async () => {
  await assert.rejects(assertPublicUrl('http://127.0.0.1/secret'), /内网/);
  await assert.rejects(assertPublicUrl('http://localhost:3000/'), /内网/);
  await assert.rejects(assertPublicUrl('file:///C:/Windows/win.ini'), /http/);
});

test('网页搜索需要有效关键词', async () => {
  await assert.rejects(searchWeb('   '), /关键词/);
});
