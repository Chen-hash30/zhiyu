import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = 'http://127.0.0.1:5173/';
const outDir = path.resolve('.shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--disable-gpu', '--hide-scrollbars'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  colorScheme: 'light',
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));

async function goto(hash, selector) {
  await page.goto(`${base}${hash}`, { waitUntil: 'domcontentloaded' });
  if (selector) await page.waitForSelector(selector, { state: 'visible' });
  await page.waitForTimeout(700);
}

await goto('#/inbox', '.note-title');
const initialStatus = await page.locator('.status-pill').first().innerText();
console.log('inbox status:', initialStatus);

// AI organize -> preview -> apply
await page.click('button:has-text("AI 整理")');
await page.waitForSelector('.modal-preview', { state: 'visible' });
console.log('preview opened');
await page.click('.modal-preview .btn-primary');
await page.waitForFunction(() => {
  const toast = document.querySelector('.toast-title');
  return toast && toast.textContent?.includes('已写入');
});
await page.waitForTimeout(900);
const urlAfter = page.url();
console.log('url after apply:', urlAfter);
const titleAfter = await page.locator('.note-title').first().innerText();
console.log('title after apply:', titleAfter);
await page.screenshot({ path: path.join(outDir, '17-after-apply.png') });
if (!titleAfter.includes('写作即思考')) throw new Error(`unexpected title after apply: ${titleAfter}`);

// Back to inbox: processed item should be marked
await goto('#/inbox', '.note-title');
const processedCount = await page.locator('.status-pill.status-done').count();
console.log('processed pills:', processedCount);

// New note flow
await goto('#/library', '.note-title');
await page.click('button:has-text("新建笔记")');
await page.waitForSelector('.modal');
await page.fill('.modal input', '测试新建笔记');
await page.click('.modal .btn-primary');
await page.waitForSelector('.editor .cm-editor');
await page.waitForTimeout(350);
const initialSaveState = await page.locator('.save-state').innerText();
console.log('editor initial state:', initialSaveState);
await page.click('.cm-content');
await page.keyboard.type('这是通过自动化测试写入的一段正文。');
await page.waitForTimeout(1400);
const savedState = await page.locator('.save-state').innerText();
console.log('editor after typing:', savedState);
await page.screenshot({ path: path.join(outDir, '18-new-note-editor.png') });
await page.click('.editor-head .btn-primary');
await page.waitForSelector('.note-title');
const newTitle = await page.locator('.note-title').first().innerText();
console.log('new note title:', newTitle);
if (newTitle !== '测试新建笔记') throw new Error('new note did not open after save');

// Command palette search
await goto('#/home', '.home');
await page.keyboard.press('Control+K');
await page.waitForSelector('.palette');
await page.fill('.palette-input', '记忆');
await page.waitForTimeout(500);
const firstResult = await page.locator('.palette-item .p-title').first().innerText();
console.log('palette first result:', firstResult);
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
const paletteTitle = await page.locator('.note-title').first().innerText();
console.log('palette opened:', paletteTitle);
if (!paletteTitle.includes('记忆')) throw new Error('palette navigation failed');

// URL import flow
await goto('#/home', '.home');
await page.click('.quick-item:has-text("添加网页")');
await page.waitForSelector('.modal input');
await page.fill('.modal input', 'https://example.com/article');
await page.click('.modal .btn-primary');
await page.waitForFunction(() => {
  const toast = document.querySelector('.toast-title');
  return toast && toast.textContent?.includes('收进收件箱');
});
await page.waitForTimeout(700);
const importedTitle = await page.locator('.note-title').first().innerText();
console.log('imported title:', importedTitle);

// Onboarding create flow
await page.goto(`${base}?empty=1#/home`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.onboarding');
await page.waitForTimeout(500);
await page.click('.onboarding-submit');
await page.waitForSelector('.home');
await page.waitForTimeout(900);
const vaultName = await page.locator('.vault-name').innerText();
console.log('created vault:', vaultName);
const welcomeNote = await page.locator('.recent-item .recent-title').first().innerText().catch(() => '');
console.log('recent after create:', welcomeNote);
await page.screenshot({ path: path.join(outDir, '19-created-vault.png') });
if (vaultName !== '我的知识库') throw new Error('vault creation failed');

console.log('console errors:', errors.length);
for (const error of [...new Set(errors)].slice(0, 20)) console.log(' -', error);
await browser.close();
