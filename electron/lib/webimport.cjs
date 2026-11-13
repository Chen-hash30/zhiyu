const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const { UserError, truncate } = require('./util.cjs');
const { extractHtml, decodeText, extractDocument } = require('./importers.cjs');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MAX_BYTES = 50 * 1024 * 1024;

function isPrivateAddress(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const lower = address.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    throw new UserError('请输入完整的 http 或 https 链接');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UserError('只支持 http 或 https 链接');
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local')
  ) {
    throw new UserError('不允许访问本机或内网地址');
  }
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new UserError('不允许访问本机或内网地址');
    return url;
  }
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (addresses.some((item) => isPrivateAddress(item.address))) {
      throw new UserError('不允许访问本机或内网地址');
    }
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('这个网址无法解析');
  }
  return url;
}

async function safeFetch(raw) {
  let current = String(raw || '').trim();
  for (let hop = 0; hop < 4; hop += 1) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      },
      signal: AbortSignal.timeout(60000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new UserError(`网页跳转失败（${response.status}）`);
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw new UserError(`网页返回了 ${response.status}`);
    return { response, url: url.toString() };
  }
  throw new UserError('网页跳转次数过多');
}

function fallbackTitle(url, contentType) {
  try {
    const parsed = new URL(url);
    const base = decodeURIComponent(path.basename(parsed.pathname));
    return base.replace(/\.(html?|pdf|docx|txt|md)$/i, '') || parsed.hostname;
  } catch {
    return contentType.includes('pdf') ? '网页文档' : '网页资料';
  }
}

async function readResponse(response) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_BYTES) throw new UserError('这个文件太大，暂时只支持 50MB 以内的资料');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) throw new UserError('这个文件太大，暂时只支持 50MB 以内的资料');
  return buffer;
}

function isDocument(contentType, extension) {
  return (
    contentType.includes('pdf') ||
    contentType.includes('wordprocessingml') ||
    extension === '.pdf' ||
    extension === '.docx'
  );
}

async function fetchPage(rawUrl) {
  const { response, url } = await safeFetch(rawUrl);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const extension = path.extname(new URL(url).pathname).toLowerCase();
  if (isDocument(contentType, extension)) {
    throw new UserError('这是一个 PDF 或 Word 链接，需要保存到收件箱后再读取。');
  }
  const buffer = await readResponse(response);
  if (contentType.includes('text/html') || contentType.includes('xhtml') || extension === '.html') {
    const page = extractHtml(buffer, fallbackTitle(url, contentType));
    return { title: page.title, url, markdown: page.body };
  }
  if (contentType.includes('text/plain') || ['.txt', '.md'].includes(extension)) {
    return {
      title: fallbackTitle(url, contentType),
      url,
      markdown: decodeText(buffer),
    };
  }
  throw new UserError('这个链接不是可读取的网页或文本资料');
}

async function importUrlContent(vault, rawUrl, options = {}) {
  const { response, url } = await safeFetch(rawUrl);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const extension = path.extname(new URL(url).pathname).toLowerCase();
  const buffer = await readResponse(response);
  let title = String(options.title || '').trim();
  let author = '';
  let content = '';
  let tags = [];
  let kind = 'web';
  if (isDocument(contentType, extension)) {
    const docExt = extension === '.docx' || contentType.includes('wordprocessingml') ? '.docx' : '.pdf';
    const temp = path.join(os.tmpdir(), `zhiyu-web-${crypto.randomUUID()}${docExt}`);
    await fsp.writeFile(temp, buffer);
    try {
      const extracted = await extractDocument(temp);
      content = extracted.body;
      author = extracted.author || '';
      title = title || fallbackTitle(url, contentType);
      tags = [docExt === '.pdf' ? 'PDF' : 'Word'];
      kind = 'file';
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  } else if (
    contentType.includes('text/html') ||
    contentType.includes('xhtml') ||
    extension === '.html' ||
    extension === '.htm'
  ) {
    const page = extractHtml(buffer, fallbackTitle(url, contentType));
    content = page.body;
    author = page.author || '';
    title = title || page.title || fallbackTitle(url, contentType);
    tags = ['网页剪藏'];
  } else if (contentType.includes('text/plain') || ['.txt', '.md'].includes(extension)) {
    content = decodeText(buffer);
    title = title || fallbackTitle(url, contentType);
    kind = 'file';
    tags = [extension === '.md' ? 'Markdown' : '文本'];
  } else {
    throw new UserError('这个链接不是可导入的网页、PDF、Word 或文本资料');
  }
  if (!content || content.replace(/\s/g, '').length < 10) {
    throw new UserError('这个链接没有可提取的正文内容');
  }
  const note = await vault.importText({
    title: title || fallbackTitle(url, contentType),
    content,
    source: String(rawUrl),
    author,
    tags,
    kind,
  });
  return { note, title: note.title, url };
}

module.exports = {
  fetchPage,
  importUrlContent,
  assertPublicUrl,
  safeFetch,
  truncate,
};
