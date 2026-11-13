import { chromium } from 'playwright-core';
import path from 'node:path';

const base = 'http://127.0.0.1:5173/';
const out = (name) => path.resolve('.shots', name);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
page.setDefaultTimeout(15000);

await page.goto(`${base}#/chat`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.chat-layout');
await page.fill('.composer-input', '收件箱里有哪些资料？');
await page.click('.composer-send');
await page.waitForSelector('.agent-trace', { state: 'visible' });
await page.waitForTimeout(350);
await page.screenshot({ path: out('45-agent-trace-running.png') });
await page.waitForFunction(() => {
  const trace = document.querySelector('.agent-trace .agent-step.done');
  return Boolean(trace);
});
await page.waitForTimeout(1800);
await page.screenshot({ path: out('46-agent-trace-done.png') });

await page.goto(`${base}#/settings`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.settings-version-card');
await page.evaluate(() => document.querySelector('.settings-version-card')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(400);
await page.screenshot({ path: out('47-settings-version-padded.png') });
await browser.close();
console.log('trace shots done');