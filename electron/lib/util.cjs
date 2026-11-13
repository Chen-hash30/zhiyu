const path = require('node:path');
const crypto = require('node:crypto');

class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.friendly = true;
  }
}

function fail(message) {
  throw new UserError(message);
}

function resolveInside(root, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    fail('文件路径无效');
  }
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    fail('不允许访问知识库以外的文件');
  }
  const abs = path.resolve(root, normalized);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    fail('不允许访问知识库以外的文件');
  }
  return abs;
}

function slugify(input, fallback = '未命名') {
  let slug = String(input || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
  if (!slug) slug = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug)) slug += '-note';
  return slug;
}

function stripMarkdown(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerptOf(markdown, length = 150) {
  const text = stripMarkdown(markdown);
  if (text.length <= length) return text;
  return `${text.slice(0, length).trim()}…`;
}

function titleFromBody(markdown) {
  const match = String(markdown || '').match(/^\s*#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function parseWikiLinks(markdown) {
  const found = new Set();
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match;
  while ((match = re.exec(String(markdown || '')))) {
    const target = match[1].trim();
    if (target) found.add(target);
  }
  return [...found];
}

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function isoDate(value, fallback = '') {
  if (!value) return fallback;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return fallback;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return date.toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function localDateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function queryTokens(query) {
  const text = String(query || '').toLowerCase().trim();
  const tokens = new Set();
  const latin = text.match(/[a-z0-9][a-z0-9+#._-]*/g) || [];
  for (const token of latin) {
    if (token.length >= 2) tokens.add(token);
  }
  const cjkRuns = text.match(/[\u3400-\u9fff]+/g) || [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.add(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      tokens.add(run.slice(i, i + 2));
    }
  }
  return [...tokens];
}

function hashText(text) {
  return crypto.createHash('sha1').update(String(text || ''), 'utf8').digest('hex');
}

function normalizeTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function truncate(text, max) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function safeJsonParse(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('没有找到 JSON 内容');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function friendlyError(error) {
  if (!error) return '操作失败，请重试';
  if (error.friendly) return error.message;
  if (typeof error === 'string') return error;
  return error.message || '操作失败，请重试';
}

module.exports = {
  UserError,
  fail,
  resolveInside,
  slugify,
  stripMarkdown,
  excerptOf,
  titleFromBody,
  parseWikiLinks,
  asStringArray,
  isoDate,
  nowIso,
  localDateStamp,
  localDateTime,
  queryTokens,
  hashText,
  normalizeTitle,
  truncate,
  safeJsonParse,
  friendlyError,
};
