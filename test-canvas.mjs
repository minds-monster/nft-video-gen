import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
page.on('pageerror', (err) => errors.push({ type: 'pageerror', message: err.message, stack: err.stack }));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
    errors.push({ type: 'console.error', text: msg.text() });
  }
});

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

const textarea = page.locator('textarea[aria-label="Describe your film"]').first();
await textarea.waitFor({ timeout: 10000 });
await textarea.click();
await page.waitForTimeout(1500);

// Click Collections tab (first tab after reorder)
const collectionsTab = page.locator('button:has-text("Collections")').first();
if (await collectionsTab.isVisible().catch(() => false)) {
  await collectionsTab.click();
  await page.waitForTimeout(1000);
}

// Click first collection row
const firstCollection = page.locator('.scrollbar-subtle button').first();
if (await firstCollection.isVisible().catch(() => false)) {
  await firstCollection.click();
  await page.waitForTimeout(2000);
}

await page.screenshot({ path: '/tmp/canvas-collections.png' });

console.log('Errors:', JSON.stringify(errors, null, 2));
console.log('Expanded count:', await page.locator('[data-expanded="true"]').count());

await browser.close();
