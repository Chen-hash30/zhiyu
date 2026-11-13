import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('.shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((item) => item.url().includes('index.html')) || pages[0];
if (!page) throw new Error('no Electron page found');
page.setDefaultTimeout(20000);
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));

await page.waitForSelector('.home', { state: 'visible' });
console.log('vault:', await page.locator('.vault-name').innerText());

await page.click('.sidebar-bottom .nav-item:has-text("设置")');
await page.waitForSelector('.settings-card');
await page.click('.preset-card:has-text("自定义")');
const inputs = page.locator('.settings-form-grid input');
await inputs.nth(0).fill('http://127.0.0.1:8788/v1');
await inputs.nth(1).fill('test-model');
await inputs.nth(2).fill('test-key');
await page.click('.settings-actions .btn-outline');
await page.waitForSelector('.test-result.ok');
console.log('connection test:', await page.locator('.test-result.ok').innerText());
await page.click('.settings-actions .btn-primary');
await page.waitForFunction(() => {
  const toast = document.querySelector('.toast-title');
  return toast && toast.textContent?.includes('模型设置已保存');
});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(outDir, '25-electron-ai-settings.png') });

const inboxBefore = await page.locator('.nav-item:has-text("收件箱") .nav-count').innerText().catch(() => '0');
console.log('inbox before:', inboxBefore);
await page.click('.nav-item:has-text("收件箱")');
await page.waitForSelector('.note-title');
await page.click('button:has-text("AI 整理")');
await page.waitForSelector('.modal-preview', { state: 'visible' });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, '26-electron-ai-preview.png') });
await page.click('.modal-preview .btn-primary');
await page.waitForFunction(() => {
  const toast = document.querySelector('.toast-title');
  return toast && toast.textContent?.includes('已写入');
});
await page.waitForTimeout(900);
const title = await page.locator('.note-title').first().innerText();
console.log('after apply title:', title);
const inboxAfter = await page.locator('.nav-item:has-text("收件箱") .nav-count').innerText().catch(() => '0');
console.log('inbox after:', inboxAfter);
await page.screenshot({ path: path.join(outDir, '27-electron-ai-applied.png') });
if (title !== '测试概念') throw new Error(`unexpected applied note: ${title}`);

// Real chat with the mock model
await page.click('.nav-item:has-text("对话")');
await page.waitForSelector('.chat-empty');
await page.fill('.composer-input', '测试概念是什么？');
await page.click('.composer-send');
await page.waitForFunction(() => {
  const bubble = document.querySelector('.assistant-bubble .markdown');
  return bubble && bubble.textContent?.includes('测试回答');
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, '28-electron-ai-chat.png') });
console.log('chat sources:', await page.locator('.source-chip').count());

console.log('console errors:', errors.length);
for (const error of [...new Set(errors)].slice(0, 20)) console.log(' -', error);

await page.evaluate(() => window.zhiyu.window.close()).catch(() => {});
await page.waitForTimeout(600);
await browser.close().catch(() => {});
