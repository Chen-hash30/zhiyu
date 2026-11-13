const { truncate } = require('./util.cjs');

function estimateTokens(value) {
  const text = String(value || '');
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const withoutCjk = text.replace(/[\u3400-\u9fff]/g, ' ');
  const latinWords = (withoutCjk.match(/[A-Za-z0-9_]+/g) || []).length;
  const punctuation = withoutCjk.replace(/[A-Za-z0-9_\s]/g, '').length;
  return Math.ceil(cjk + latinWords * 1.3 + punctuation * 0.25);
}

function estimateMessages(messages = []) {
  return messages.reduce(
    (total, message) => total + 4 + estimateTokens(message?.content || ''),
    0,
  );
}

function estimateContextTokens(
  messages = [],
  summary = '',
  summaryCount = 0,
  overhead = 3000,
) {
  const recent = messages.slice(Math.max(0, Number(summaryCount) || 0));
  return overhead + estimateTokens(summary) + estimateMessages(recent);
}

function buildEffectiveMessages(messages = [], summaryCount = 0) {
  return messages.slice(Math.max(0, Number(summaryCount) || 0));
}

function contextSummaryText(summary) {
  return truncate(String(summary || ''), 4000);
}

module.exports = {
  estimateTokens,
  estimateMessages,
  estimateContextTokens,
  buildEffectiveMessages,
  contextSummaryText,
};