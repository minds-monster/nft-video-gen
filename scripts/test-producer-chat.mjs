// Phase 2 (Test 2) verification — see
// /Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md.
// Drives the actual site (not a script talking to the API directly) to prove the
// Producer panel can hold a conversation with the third-party test Mind.

import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errors = [];
page.on('pageerror', (err) => errors.push({ type: 'pageerror', message: err.message, stack: err.stack }));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
    errors.push({ type: 'console.error', text: msg.text() });
  }
});
page.on('requestfailed', (req) => errors.push({ type: 'requestfailed', url: req.url(), failure: req.failure()?.errorText }));

await page.goto('http://localhost:5176/', { waitUntil: 'networkidle' });

// Expand the Neural Canvas by focusing the hero composer textarea.
const textarea = page.locator('textarea[aria-label="Describe your film"]').first();
await textarea.waitFor({ timeout: 10000 });
await textarea.click();
await page.waitForTimeout(1500);

// Producer panel's chat input is uniquely identified by its placeholder/aria-label.
// Its submit button shares aria-label="Generate" with the main composer's button
// elsewhere on the page, so scope to the form that actually contains this input.
const producerInput = page.locator('input[aria-label="Direct the film…"]').first();
await producerInput.waitFor({ timeout: 10000 });
const producerForm = page.locator('form:has(input[aria-label="Direct the film…"])').first();
const producerButton = producerForm.locator('button[aria-label="Generate"]').first();

await page.screenshot({ path: '/tmp/producer-before-send.png' });

const testMessage = `Playwright site test ${new Date().toISOString()}: hello from the actual Producer panel UI.`;
await producerInput.click();
await producerInput.fill(testMessage);
await producerButton.click();

// Confirm the message we typed shows up in the thread as sent. ChatThread.jsx renders
// every message (human and mind alike) as a `p.whitespace-pre-wrap` inside its bubble —
// our own sent message is the first one to appear.
await page.waitForTimeout(1500);
const sentVisible = await page.locator(`text=${JSON.stringify(testMessage).slice(1, -1).slice(0, 40)}`).first().isVisible().catch(() => false);

await page.screenshot({ path: '/tmp/producer-after-send.png' });

// Wait up to ~75s for a reply to appear (the Mind's owner may reply manually), without
// blocking forever — this is best-effort, not a hard requirement for this check. A reply
// means a second `p.whitespace-pre-wrap` bubble beyond our own sent message.
let replyObserved = false;
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(5000);
  const bubbleCount = await page.locator('p.whitespace-pre-wrap').count().catch(() => 0);
  if (bubbleCount > 1) { replyObserved = true; break; }
}

await page.screenshot({ path: '/tmp/producer-final.png' });

console.log('Errors:', JSON.stringify(errors, null, 2));
console.log('Sent message visible in thread:', sentVisible);
console.log('Reply observed within wait window:', replyObserved);

await browser.close();
