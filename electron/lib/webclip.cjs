const { parseHTML } = require('linkedom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');
const { UserError, truncate } = require('./util.cjs');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function clipUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch {
    throw new UserError('请输入完整的网页链接，例如 https://example.com/article');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new UserError('只支持 http 或 https 链接');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      },
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new UserError('网页加载超时，请检查网络后再试');
    }
    throw new UserError('无法访问这个网页，请检查网络或链接是否正确');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new UserError(`网页返回了 ${response.status}，暂时无法读取`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!/html|text\/plain/i.test(contentType)) {
    throw new UserError('这个链接不是网页正文，暂时无法导入');
  }
  const html = await response.text();
  if (!html.trim()) {
    throw new UserError('网页内容为空，暂时无法导入');
  }

  let title = parsed.hostname;
  let byline = '';
  let markdown = '';

  try {
    const { document } = parseHTML(html);
    const reader = new Readability(document, { charThreshold: 120 });
    const article = reader.parse();
    if (article && article.content) {
      title = (article.title || document.title || title).trim();
      byline = (article.byline || '').trim();
      const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '*',
      });
      turndown.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button']);
      markdown = turndown.turndown(article.content);
    }
  } catch {
    markdown = '';
  }

  if (!markdown || markdown.replace(/\s/g, '').length < 120) {
    try {
      const { document } = parseHTML(html);
      document.querySelectorAll('script,style,noscript,nav,footer,header,svg').forEach((node) => node.remove());
      const text = (document.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
      const fallbackTitle = (document.title || title).trim();
      if (text.length > 120) {
        title = fallbackTitle;
        markdown = text;
      }
    } catch {
      // ignore
    }
  }

  if (!markdown || markdown.replace(/\s/g, '').length < 30) {
    throw new UserError('没有从这个页面读到正文，可以复制内容后使用「粘贴文本」');
  }

  markdown = truncate(markdown, 120000);
  return {
    title: title.slice(0, 160) || parsed.hostname,
    byline,
    url: parsed.toString(),
    markdown,
  };
}

module.exports = { clipUrl };
