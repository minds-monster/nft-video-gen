import { chromium } from '@playwright/test';

const TEST_MIND_ID = 'ee784e3e-f36b-1410-8466-00039ce7df11';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) errors.push(msg.text());
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });

await page.locator('header button:has-text("Connect Mind")').first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/ux-form-state.png' });

const dialog = page.locator('[role="dialog"]');
const mindIdInput = dialog.locator('input[placeholder*="240b453e"]').first();
await mindIdInput.waitFor({ timeout: 5000 });
await mindIdInput.fill(TEST_MIND_ID);
await dialog.locator('button[type="submit"]').first().click();

await page.waitForTimeout(6000);
await page.screenshot({ path: '/tmp/ux-pending-state.png' });

const bodyText = await page.locator('body').innerText();
console.log('Shows "Approve it yourself":', bodyText.includes('Approve it yourself'));
console.log('Shows "Want this automatic next time":', bodyText.includes('Want this automatic next time'));
console.log('Shows "Message sent":', bodyText.includes('Message sent'));
console.log('Shows elapsed seconds hint:', bodyText.includes('typical reply'));
console.log('Errors:', JSON.stringify(errors));

await browser.close();
