import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages[0];
if (!page) throw new Error('no packaged app page');
page.setDefaultTimeout(20000);
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));

console.log('url:', page.url());
await page.waitForSelector('.home', { state: 'visible' });
console.log('vault:', await page.locator('.vault-name').innerText());
console.log('version:', await page.evaluate(() => window.zhiyu.app.version()));
console.log('knowledge count:', await page.locator('.stat-value').nth(1).innerText());
await page.screenshot({ path: '.shots/29-packaged-home.png' });

await page.click('.sidebar-bottom .nav-item:has-text("设置")');
await page.waitForSelector('.settings-card');
console.log('settings loaded, preset:', await page.locator('.preset-card.active .preset-name').innerText());
await page.screenshot({ path: '.shots/30-packaged-settings.png' });

console.log('console errors:', errors.length);
for (const error of [...new Set(errors)].slice(0, 20)) console.log(' -', error);

await page.evaluate(() => window.zhiyu.window.close()).catch(() => {});
await page.waitForTimeout(500);
await browser.close().catch(() => {});
