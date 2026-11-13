import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = 'http://127.0.0.1:5173/';
const outDir = path.resolve('.shots');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  colorScheme: 'light',
});
const page = await context.newPage();
page.setDefaultTimeout(15000);

async function go(hash, selector, wait = 600) {
  await page.goto(`${base}${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(selector, { state: 'visible' });
  await page.waitForTimeout(wait);
}

await go('#/inbox', '.note-item', 1000);
await page.click('button:has-text("AI 整理")');
await page.waitForSelector('.ai-working-overlay .ai-live pre', { state: 'visible' });
await page.waitForFunction(() => {
  const pre = document.querySelector('.ai-working-overlay .ai-live pre');
  return pre && pre.textContent && !pre.textContent.includes('模型返回后');
}, null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(outDir, '40-mock-live-organize.png') });

await page.goto(`${base}#/chat`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.chat-layout', { state: 'visible' });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(outDir, '41-mock-chat.png') });

await go('#/trash', '.trash-page');
await page.screenshot({ path: path.join(outDir, '42-mock-trash.png') });

await go('#/settings', '.settings-card');
await page.evaluate(() => {
  document.querySelector('.mcp-card')?.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(outDir, '43-mock-settings-mcp.png') });

await browser.close();
console.log('mock shots done');