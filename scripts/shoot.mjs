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
  deviceScaleFactor: 1,
  locale: 'zh-CN',
  colorScheme: 'light',
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));

async function goto(hash, selector, wait = 900) {
  await page.goto(`${base}${hash}`, { waitUntil: 'domcontentloaded' });
  if (selector) await page.waitForSelector(selector, { state: 'visible' });
  await page.waitForTimeout(wait);
}

async function shot(name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`shot ${name}`);
}

async function task(name, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

await task('home', async () => {
  await goto('#/home', '.home');
  await shot('01-home');
});

await task('inbox', async () => {
  await goto('#/inbox', '.page-split', 1200);
  await page.waitForSelector('.note-title');
  await shot('02-inbox');
});

await task('ai-flow', async () => {
  await goto('#/inbox', '.note-title', 1000);
  await page.click('button:has-text("AI 整理")');
  await page.waitForSelector('.ai-working-overlay');
  await page.waitForTimeout(250);
  await shot('03-ai-working');
  await page.waitForSelector('.modal-preview', { state: 'visible' });
  await page.waitForTimeout(450);
  await shot('04-ai-preview');
  await page.click('.modal-preview .preview-list-item:nth-of-type(2)').catch(() => {});
  await page.click('.preview-tabs button:has-text("改动")').catch(() => {});
  await page.waitForTimeout(300);
  await shot('05-ai-diff');
});

await task('library', async () => {
  await goto('#/library', '.note-title', 1000);
  await shot('06-library');
});

await task('editor', async () => {
  await goto('#/library', '.note-title', 1000);
  await page.click('.reader-actions button:has-text("编辑")');
  await page.waitForSelector('.editor .cm-editor');
  await page.waitForTimeout(500);
  await shot('07-editor');
});

await task('chat-empty', async () => {
  await goto('#/chat', '.chat-empty');
  await shot('08-chat-empty');
});

await task('chat-answer', async () => {
  await goto('#/chat', '.chat-empty');
  await page.click('.suggestion');
  await page.waitForSelector('.assistant-bubble');
  await page.waitForTimeout(2600);
  await shot('09-chat-answer');
});

await task('graph', async () => {
  await goto('#/graph', '.graph-svg', 2200);
  await shot('10-graph');
});

await task('settings', async () => {
  await goto('#/settings', '.settings-card');
  await shot('11-settings');
});

await task('rules', async () => {
  await goto('#/settings', '.settings-card');
  await page.click('button:has-text("编辑规则")');
  await page.waitForSelector('.rules-editor');
  await page.waitForTimeout(300);
  await shot('12-rules');
});

await task('palette', async () => {
  await page.keyboard.press('Escape').catch(() => {});
  await goto('#/home', '.home');
  await page.keyboard.press('Control+K');
  await page.waitForSelector('.palette');
  await page.waitForTimeout(250);
  await shot('13-palette');
});

await task('onboarding', async () => {
  await page.goto(`${base}?empty=1#/home`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.onboarding');
  await page.waitForTimeout(700);
  await shot('14-onboarding');
});

await task('dark', async () => {
  await page.goto(`${base}?theme=dark#/home`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.home');
  await page.waitForTimeout(900);
  await shot('15-home-dark');
});

await task('library-dark', async () => {
  await page.goto(`${base}?theme=dark#/library`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.note-title');
  await page.waitForTimeout(700);
  await shot('16-library-dark');
});

console.log('console errors:', errors.length);
for (const error of [...new Set(errors)].slice(0, 20)) console.log(' -', error);
await browser.close();
