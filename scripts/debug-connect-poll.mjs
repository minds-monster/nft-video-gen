import { chromium } from '@playwright/test';

const ADAM_MIND_ID = '240b453e-f36b-1410-8466-00039ce7df11';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

page.on('console', (msg) => console.log(`[browser:${msg.type()}]`, msg.text()));
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });

await page.locator('header button:has-text("Connect Mind")').first().click();
const dialog = page.locator('[role="dialog"]');
const mindIdInput = dialog.locator('input[placeholder*="240b453e"]').first();
await mindIdInput.waitFor({ timeout: 5000 });
await mindIdInput.fill(ADAM_MIND_ID);
await dialog.locator('button[type="submit"]').first().click();

console.log('--- watching console for 3 minutes ---');
await page.waitForTimeout(3 * 60 * 1000);

const finalText = await page.locator('body').innerText();
console.log('--- final body text snippet ---');
console.log(finalText.includes('denied') ? 'DENIED shown' : finalText.includes('Connected') ? 'CONNECTED shown' : 'still pending/other');

await browser.close();
