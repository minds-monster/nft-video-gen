// Full click-through test of the real Connect Mind flow (Track B), against Adam's
// own Mind — expect an autonomous DENY via the Skill (Track A), and confirm the modal
// correctly reflects idle -> pending -> denied.

import { chromium } from '@playwright/test';

const ADAM_MIND_ID = '240b453e-f36b-1410-8466-00039ce7df11';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errors = [];
page.on('pageerror', (err) => errors.push({ type: 'pageerror', message: err.message }));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
    errors.push({ type: 'console.error', text: msg.text() });
  }
});
page.on('response', (res) => {
  if (res.url().includes('/api/connect/init')) {
    res.json().then((data) => console.log('connectionId:', data.connectionId)).catch(() => {});
  }
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });

const connectButton = page.locator('header button:has-text("Connect Mind")').first();
await connectButton.waitFor({ timeout: 10000 });
await connectButton.click();

await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/connect-modal-open.png' });

const dialog = page.locator('[role="dialog"]');
const mindIdInput = dialog.locator('input[placeholder*="240b453e"]').first();
await mindIdInput.waitFor({ timeout: 5000 });
await mindIdInput.fill(ADAM_MIND_ID);
await dialog.locator('button[type="submit"]').first().click();

await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/connect-modal-pending.png' });
const pendingText = await page.locator('body').innerText();
console.log('Shows "Waiting for approval":', pendingText.includes('Waiting for approval'));

console.log('Waiting up to 10 minutes for the autonomous DENY from Adam\'s Skill...');
let finalState = null;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(10_000);
  const text = await page.locator('body').innerText();
  if (text.includes('Connection denied')) {
    finalState = 'denied';
    break;
  }
  if (text.includes('Connected ·')) {
    finalState = 'approved';
    break;
  }
}

await page.screenshot({ path: '/tmp/connect-modal-final.png' });
console.log('Final state observed:', finalState ?? 'still pending after wait window');
console.log('Errors:', JSON.stringify(errors, null, 2));

await browser.close();
