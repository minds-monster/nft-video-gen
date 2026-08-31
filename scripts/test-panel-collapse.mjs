import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) errors.push(msg.text());
});

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });

const textarea = page.locator('textarea[aria-label="Describe your film"]').first();
await textarea.waitFor({ timeout: 10000 });
await textarea.click();
await page.waitForTimeout(2000);

await page.screenshot({ path: '/tmp/collapse-before.png' });

// Confirm no "Try" suggestion chips inside the Producer panel specifically.
const producerPanel = page.locator('form:has(input[aria-label="Direct the film…"])').first()
  .locator('xpath=ancestor::div[contains(@class,"flex") and contains(@class,"flex-col")][1]');
const producerText = await producerPanel.innerText().catch(() => '');
console.log('Producer area text (first 200 chars):', JSON.stringify(producerText.slice(0, 200)));

// Collapse all four inspector panels via their "Collapse X" buttons.
for (const title of ['Casting Director', 'Screenwriter', 'Screenplay', 'Storyboarder']) {
  const btn = page.locator(`button[aria-label="Collapse ${title}"]`).first();
  const visible = await btn.isVisible().catch(() => false);
  console.log(`Collapse button for "${title}" visible:`, visible);
  if (visible) {
    await btn.click();
    await page.waitForTimeout(400);
  }
}

await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/collapse-after.png' });

// Confirm expand buttons now exist.
for (const title of ['Casting Director', 'Screenwriter', 'Screenplay', 'Storyboarder']) {
  const btn = page.locator(`button[aria-label="Expand ${title}"]`).first();
  console.log(`Expand button for "${title}" visible:`, await btn.isVisible().catch(() => false));
}

console.log('Errors:', JSON.stringify(errors));
await browser.close();
