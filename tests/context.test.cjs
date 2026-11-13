const test = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateTokens,
  estimateContextTokens,
  buildEffectiveMessages,
} = require('../electron/lib/context.cjs');

test('上下文 token 估算与有效消息裁剪', () => {
  assert.ok(estimateTokens('你好世界') >= 4);
  assert.ok(estimateTokens('hello world') >= 2);
  const messages = [
    { role: 'user', content: '第一条消息' },
    { role: 'assistant', content: '第二条消息' },
    { role: 'user', content: '第三条消息' },
  ];
  const withSummary = estimateContextTokens(messages, '已有摘要', 1);
  const withoutSummary = estimateContextTokens(messages, '', 0);
  assert.ok(withSummary < withoutSummary);
  assert.deepEqual(buildEffectiveMessages(messages, 1), messages.slice(1));
  assert.deepEqual(buildEffectiveMessages(messages, 0), messages);
});