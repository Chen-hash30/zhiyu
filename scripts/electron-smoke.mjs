import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('.shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const pages = browser.contexts().flatMap((context) => context.pages());
console.log('pages:', pages.map((page) => page.url()));
const page = pages.find((item) => item.url().includes('index.html')) || pages[0];
if (!page) throw new Error('no Electron page found');
page.setDefaultTimeout(20000);
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));

await page.waitForSelector('.home, .onboarding', { state: 'visible' });
const isOnboarding = await page.locator('.onboarding').count();
console.log('onboarding visible:', Boolean(isOnboarding));
if (isOnboarding) {
  throw new Error('settings.json was not picked up; isolated userData not applied');
}
const vaultName = await page.locator('.vault-name').innerText();
console.log('vault:', vaultName);
await page.screenshot({ path: path.join(outDir, '20-electron-home.png') });

// Import text through real IPC and file storage
await page.click('.page-actions button:has-text("粘贴文本")');
await page.waitForSelector('.modal textarea');
await page.waitForTimeout(350);
await page.fill('.modal input[data-autofocus]', 'Electron 冒烟测试资料');
await page.fill('.modal textarea', '这是通过真实 Electron IPC 写入的一段资料。\n\n它应该出现在 raw 文件夹里，并带有 inbox 状态。');
await page.waitForTimeout(200);
await page.click('.modal .btn-primary');
await page.waitForFunction(() => {
  const toast = document.querySelector('.toast-title');
  return toast && toast.textContent?.includes('收进收件箱');
});
await page.waitForTimeout(600);
const importedTitle = await page.locator('.note-title').first().innerText();
console.log('imported note:', importedTitle);
await page.screenshot({ path: path.join(outDir, '21-electron-inbox.png') });

// AI organize should fail cleanly without a key, without touching files
await page.click('button:has-text("AI 整理")');
await page.waitForFunction(() => {
  const toasts = [...document.querySelectorAll('.toast-desc')];
  return toasts.some((node) => node.textContent?.includes('连接模型服务'));
});
console.log('AI without key produced a clear error');
await page.screenshot({ path: path.join(outDir, '22-electron-no-key.png') });

// Create a wiki note and verify autosave through real IPC
await page.click('.nav-item:has-text("知识库")');
await page.waitForSelector('.page');
await page.click('.page-actions button:has-text("新建笔记")');
await page.waitForSelector('.modal input');
await page.fill('.modal input', 'Electron 冒烟笔记');
await page.click('.modal .btn-primary');
await page.waitForSelector('.editor .cm-editor');
await page.click('.cm-content');
await page.keyboard.type('这是真实 Electron 窗口写入的正文。');
await page.keyboard.type('\n\n## 冒烟测试\n\n这段文字用于验证自动保存。');
await page.waitForFunction(() => {
  const status = document.querySelector('.save-state');
  return status && status.textContent?.includes('已保存');
});
await page.waitForTimeout(800);
const editorState = await page.locator('.save-state').innerText();
console.log('editor state:', editorState);
await page.click('.editor-head .btn-primary');
await page.waitForSelector('.note-title');
const libraryTitle = await page.locator('.note-title').first().innerText();
const bodyText = await page.locator('.reader-body').innerText();
console.log('edited note:', libraryTitle, 'contains test text:', bodyText.includes('冒烟测试'));
if (!bodyText.includes('冒烟测试')) throw new Error('autosave did not persist the note body');
await page.screenshot({ path: path.join(outDir, '23-electron-edited.png') });

// Real git snapshot through preload IPC
const gitState = await page.evaluate(() => window.zhiyu.git.snapshot('冒烟测试快照'));
console.log('git snapshot:', JSON.stringify(gitState.latest));

// Settings page through real renderer
await page.click('.sidebar-bottom .nav-item:has-text("设置")');
await page.waitForSelector('.settings-card');
await page.screenshot({ path: path.join(outDir, '24-electron-settings.png') });

console.log('console errors:', errors.length);
for (const error of [...new Set(errors)].slice(0, 20)) console.log(' -', error);

await page.evaluate(() => window.zhiyu.window.close());
await page.waitForTimeout(800);
await browser.close();
