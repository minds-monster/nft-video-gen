import { chromium } from '@playwright/test';

const ADAM_MIND_ID = '240b453e-f36b-1410-8466-00039ce7df11';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();

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

// Test the copy button while pending.
await page.waitForTimeout(6000);
const copyBtn = dialog.locator('button:has-text("Copy")').first();
await copyBtn.click();
const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
console.log('Clipboard after copy:', clipboardText.startsWith('APPROVE ') ? 'starts with APPROVE (correct)' : `unexpected: ${clipboardText.slice(0, 40)}`);

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

await dialog.locator('button[aria-label="Close"]').first().click();
await page.waitForTimeout(500);

const textarea = page.locator('textarea[aria-label="Describe your film"]').first();
await textarea.waitFor({ timeout: 10000 });
await textarea.click();
await page.waitForTimeout(1500);

const bodyText = await page.locator('body').innerText();
console.log('Producer shows "Connected to":', /Connected to/i.test(bodyText));
console.log('Producer shows "typical reply":', /typical reply/i.test(bodyText));

const producerForm = page.locator('form:has(input[aria-label="Direct the film…"])').first();
const producerInput = producerForm.locator('input[aria-label="Direct the film…"]').first();
await producerInput.fill(`UX test ${new Date().toISOString()}: quick hello.`);
await producerForm.locator('button[aria-label="Generate"]').first().click();

await page.waitForTimeout(2000);
const sendingText = await page.locator('body').innerText();
console.log('Shows new waiting copy "Waiting for Mind reply":', sendingText.includes('Waiting for Mind reply'));
console.log('Does NOT show old "Generating your film":', !sendingText.includes('Generating your film'));

console.log('Errors:', JSON.stringify(errors));
await browser.close();
