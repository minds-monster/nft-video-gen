import { chromium } from '@playwright/test';

const ADAM_MIND_ID = '240b453e-f36b-1410-8466-00039ce7df11';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) errors.push(msg.text());
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });

await page.locator('header button:has-text("Connect Mind")').first().click();
const dialog = page.locator('[role="dialog"]');
const mindIdInput = dialog.locator('input[placeholder*="240b453e"]').first();
await mindIdInput.waitFor({ timeout: 5000 });
await mindIdInput.fill(ADAM_MIND_ID);
await dialog.locator('button[type="submit"]').first().click();

console.log('Waiting up to 3 minutes for connection...');
let connected = false;
for (let i = 0; i < 18; i++) {
  await page.waitForTimeout(10_000);
  const text = await page.locator('body').innerText();
  if (text.includes('Connected ·')) { connected = true; break; }
  if (text.includes('Connection denied')) { console.log('Denied this time.'); break; }
}
console.log('Connected:', connected);
if (!connected) { await browser.close(); process.exit(1); }

// Dashboard should now be showing (state !== 'pending' branch renders automatically).
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/dashboard-connected.png' });

const bodyText = await page.locator('body').innerText();
console.log('Shows Cognition stat:', bodyText.includes('COGNITION') || bodyText.includes('Cognition'));
console.log('Shows Moca stat:', bodyText.includes('MOCA') || bodyText.includes('Moca'));
console.log('Shows Disconnect button:', bodyText.includes('Disconnect'));
console.log('Shows identity-check hint:', bodyText.includes('something only it would know'));

// Close modal, reopen via header button — should show dashboard again, not the form.
await dialog.locator('button[aria-label="Close"]').first().click();
await page.waitForTimeout(500);
await page.locator('header button:has-text("Connected")').first().click();
await page.waitForTimeout(1000);
const reopenText = await page.locator('body').innerText();
console.log('Reopened modal still shows dashboard (Disconnect visible):', reopenText.includes('Disconnect'));
await page.screenshot({ path: '/tmp/dashboard-reopened.png' });

// Disconnect.
await dialog.locator('button:has-text("Disconnect")').first().click();
await page.waitForTimeout(500);
const afterDisconnect = await page.locator('body').innerText();
console.log('Header reverted to "Connect Mind" after disconnect:', afterDisconnect.includes('Connect Mind'));

console.log('Errors:', JSON.stringify(errors));
await browser.close();
