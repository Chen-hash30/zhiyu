import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
page.setDefaultTimeout(15000);

await page.goto(`${base}#/chat`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.chat-layout');
await page.fill('.composer-input', '收件箱里有哪些资料？');
await page.click('.composer-send');
await page.waitForTimeout(2600);
const state = await page.evaluate(() => ({
  thinkingOpen: Boolean(document.querySelector('.thinking-body')),
  agentOpen: Boolean(document.querySelector('.agent-trace-body')),
  hasThinking: Boolean(document.querySelector('.thinking-head')),
  hasAgent: Boolean(document.querySelector('.agent-trace-head')),
}));
console.log('auto state', state);
await page.click('.thinking-head').catch(() => {});
await page.click('.agent-trace-head').catch(() => {});
await page.waitForTimeout(250);
await page.screenshot({ path: '.shots/49-agent-expanded.png' });
await browser.close();