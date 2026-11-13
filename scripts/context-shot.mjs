import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
page.setDefaultTimeout(20000);
await page.goto(`${base}#/chat`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.chat-layout');
for (let i = 1; i <= 7; i += 1) {
  await page.fill('.composer-input', `测试消息 ${i}：帮我整理一点上下文管理相关的思路。`);
  await page.click('.composer-send');
  await page.waitForTimeout(1200);
}
await page.click('.context-pill');
await page.waitForSelector('.context-panel');
await page.screenshot({ path: '.shots/50-context-panel.png' });
await page.click('.context-compress');
await page.waitForSelector('.context-summary-card');
await page.waitForTimeout(500);
await page.evaluate(() => {
  const body = document.querySelector('.chat-body');
  if (body) body.scrollTop = 0;
});
await page.waitForTimeout(300);
await page.screenshot({ path: '.shots/51-context-compressed.png' });
console.log(await page.evaluate(() => ({
  pill: document.querySelector('.context-pill')?.textContent,
  summary: document.querySelector('.context-summary-card')?.textContent?.slice(0, 100),
})));
await browser.close();
