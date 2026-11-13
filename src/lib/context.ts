export function estimateTokens(value: string) {
  const text = String(value || '');
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const withoutCjk = text.replace(/[\u3400-\u9fff]/g, ' ');
  const latinWords = (withoutCjk.match(/[A-Za-z0-9_]+/g) || []).length;
  const punctuation = withoutCjk.replace(/[A-Za-z0-9_\s]/g, '').length;
  return Math.ceil(cjk + latinWords * 1.3 + punctuation * 0.25);
}

export function estimateContextTokens(
  messages: { content: string }[],
  summary = '',
  summaryCount = 0,
  overhead = 3000,
) {
  const recent = messages.slice(Math.max(0, Number(summaryCount) || 0));
  const messageTokens = recent.reduce(
    (total, message) => total + 4 + estimateTokens(message.content),
    0,
  );
  return overhead + estimateTokens(summary) + messageTokens;
}

export function formatTokens(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k`;
  return String(value);
}