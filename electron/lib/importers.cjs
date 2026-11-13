const fsp = require('node:fs/promises');
const path = require('node:path');
const mammoth = require('mammoth');
const TurndownService = require('turndown');
const { parseHTML } = require('linkedom');
const { Readability } = require('@mozilla/readability');
const { UserError } = require('./util.cjs');

const BINARY_EXTENSIONS = new Set(['.pdf', '.docx', '.html', '.htm']);
const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', ...BINARY_EXTENSIONS]);

function turndown(html) {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  service.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button', 'svg']);
  return normalizeMarkdown(service.turndown(String(html || '')));
}

function normalizeMarkdown(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectCharset(buffer) {
  const head = Buffer.from(buffer.subarray(0, 4096)).toString('latin1');
  const match = /charset\s*=\s*["']?([\w-]+)/i.exec(head);
  if (!match) return '';
  const charset = match[1].toLowerCase();
  if (charset === 'gb2312' || charset === 'gbk') return 'gb18030';
  return charset;
}

function decodeText(buffer) {
  const candidates = ['utf-8', 'gb18030'];
  for (const encoding of candidates) {
    try {
      const text = new TextDecoder(encoding, { fatal: false }).decode(buffer);
      if (!text.includes('\uFFFD')) return text.replace(/^\uFEFF/, '');
    } catch {
      // try next decoder
    }
  }
  return new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
}

function decodeHtml(buffer) {
  const charset = detectCharset(buffer);
  const candidates = [...new Set([charset, 'utf-8', 'gb18030'].filter(Boolean))];
  for (const encoding of candidates) {
    try {
      const text = new TextDecoder(encoding, { fatal: false }).decode(buffer);
      if (!text.includes('\uFFFD')) return text;
    } catch {
      // try next decoder
    }
  }
  return new TextDecoder('utf-8').decode(buffer);
}

async function extractPdf(buffer, fallbackTitle) {
  let result;
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    result = await extractText(pdf, { mergePages: true });
  } catch (error) {
    throw new UserError(`这份 PDF 无法读取，可能已加密或文件损坏：${error.message}`);
  }
  const body = normalizeMarkdown(result.text);
  if (body.replace(/\s/g, '').length < 10) {
    throw new UserError('这份 PDF 没有可提取的文字，可能是扫描版；请先做 OCR 再导入。');
  }
  return { title: fallbackTitle, body, author: '' };
}

async function extractDocx(buffer, fallbackTitle) {
  let html;
  try {
    const result = await mammoth.convertToHtml({ buffer });
    html = result.value;
  } catch (error) {
    throw new UserError(`这份 Word 文档无法读取：${error.message}`);
  }
  const body = turndown(html);
  if (body.replace(/\s/g, '').length < 10) {
    throw new UserError('这份 Word 文档没有可提取的文字，可能只包含图片。');
  }
  return { title: fallbackTitle, body, author: '' };
}

function extractHtml(buffer, fallbackTitle) {
  const html = decodeHtml(buffer);
  let title = fallbackTitle;
  let author = '';
  let markdown = '';
  let document;
  try {
    ({ document } = parseHTML(html));
    const pageTitle = (document.querySelector('title')?.textContent || '').trim();
    if (pageTitle) title = pageTitle;
    const reader = new Readability(document, { charThreshold: 80 });
    const article = reader.parse();
    if (article?.content) {
      if (article.title) title = String(article.title).trim();
      author = String(article.byline || '').trim();
      markdown = turndown(article.content);
    }
  } catch {
    markdown = '';
  }
  if (!markdown || markdown.replace(/\s/g, '').length < 40) {
    try {
      ({ document } = parseHTML(html));
      document.querySelectorAll('script,style,noscript,iframe,form').forEach((node) => node.remove());
      markdown = turndown(document.body?.innerHTML || html);
    } catch {
      markdown = normalizeMarkdown(html.replace(/<[^>]+>/g, ' '));
    }
  }
  if (!markdown || markdown.replace(/\s/g, '').length < 10) {
    throw new UserError('这个 HTML 文件没有可提取的正文。');
  }
  return { title: title || fallbackTitle, body: markdown, author };
}

async function extractDocument(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new UserError('支持 Markdown、TXT、PDF、Word (.docx) 和 HTML 文件');
  }
  const stat = await fsp.stat(absPath).catch(() => null);
  if (!stat || !stat.isFile()) throw new UserError('找不到这个文件');
  const base = path.basename(absPath, ext);
  if (ext === '.pdf' || ext === '.docx' || ext === '.html' || ext === '.htm') {
    const buffer = await fsp.readFile(absPath);
    if (ext === '.pdf') return extractPdf(buffer, base);
    if (ext === '.docx') return extractDocx(buffer, base);
    return extractHtml(buffer, base);
  }
  const buffer = await fsp.readFile(absPath);
  return { title: base, body: decodeText(buffer), author: '', plain: true };
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  BINARY_EXTENSIONS,
  extractDocument,
  decodeText,
  decodeHtml,
  normalizeMarkdown,
  turndown,
};
