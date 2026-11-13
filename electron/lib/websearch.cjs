const { parseHTML } = require('linkedom');
const { UserError } = require('./util.cjs');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function searchWeb(query, limit = 5) {
  const text = String(query || '').trim();
  if (!text) throw new UserError('搜索需要提供关键词');
  const count = Math.max(1, Math.min(5, Number(limit) || 5));
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(text)}&setlang=zh-CN`;
  let html;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`搜索服务返回 ${response.status}`);
    html = await response.text();
  } catch (error) {
    throw new UserError(`暂时无法搜索网页：${error.message}`);
  }
  let document;
  try {
    ({ document } = parseHTML(html));
  } catch {
    throw new UserError('搜索页面无法解析');
  }
  const nodes = [...document.querySelectorAll('li.b_algo')];
  const results = [];
  for (const node of nodes) {
    const link = node.querySelector('h2 a') || node.querySelector('a[href]');
    const href = link?.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) continue;
    const title = String(link.textContent || '').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const snippetNode = node.querySelector('.b_caption p, .b_snippet, .b_lineclamp2, p');
    const snippet = String(snippetNode?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    results.push({ title: title.slice(0, 160), url: href, snippet });
    if (results.length >= count) break;
  }
  if (!results.length) {
    throw new UserError('没有搜到可用结果，可以换一个更具体的关键词。');
  }
  return results;
}

module.exports = { searchWeb };
