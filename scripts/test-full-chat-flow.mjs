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

console.log('Waiting up to 3 minutes for approval...');
let connected = false;
for (let i = 0; i < 18; i++) {
  await page.waitForTimeout(10_000);
  const text = await page.locator('body').innerText();
  if (text.includes('Connected ·')) { connected = true; break; }
  if (text.includes('Connection denied')) { console.log('DENIED this time — stopping.'); break; }
}
console.log('Connected:', connected);
if (!connected) { await browser.close(); process.exit(1); }

// Close the modal, open the Neural Canvas, use the Producer panel's real chat.
await page.locator('[role="dialog"] button[aria-label="Close"]').first().click();
await page.waitForTimeout(500);

const textarea = page.locator('textarea[aria-label="Describe your film"]').first();
await textarea.waitFor({ timeout: 10000 });
await textarea.click();
await page.waitForTimeout(1500);

const producerForm = page.locator('form:has(input[aria-label="Direct the film…"])').first();
const producerInput = producerForm.locator('input[aria-label="Direct the film…"]').first();
await producerInput.waitFor({ timeout: 10000 });
const producerButton = producerForm.locator('button[aria-label="Generate"]').first();

const testMessage = `Full Track B test ${new Date().toISOString()}: this is going through the real session now.`;
await producerInput.fill(testMessage);
await producerButton.click();

console.log('Message sent via real session. Waiting up to 2 minutes for a reply...');
let replied = false;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(10_000);
  const count = await page.locator('p.whitespace-pre-wrap').count();
  if (count > 1) { replied = true; break; }
}
console.log('Reply rendered in Producer panel:', replied);
console.log('Errors:', JSON.stringify(errors));

await page.screenshot({ path: '/tmp/full-chat-flow-final.png' });
await browser.close();
