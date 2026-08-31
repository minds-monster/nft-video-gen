import { chromium } from '@playwright/test';

const SESSION = {
  token: 'eyJtaW5kSWQiOiIyNDBiNDUzZS1mMzZiLTE0MTAtODQ2Ni0wMDAzOWNlN2RmMTEiLCJjb25uZWN0aW9uSWQiOiJkaWFnLXZpc3VhbC10ZXN0IiwiaWF0IjoxNzg3Mzk2MjYxMDMyLCJleHAiOjE3ODczOTk4NjEwMzJ9.H5-Aly7p8iRRT6GCVUQ7eJyUuo6Bn-C8wirMo5VQDGA',
  mindId: '240b453e-f36b-1410-8466-00039ce7df11',
  mindName: 'Adam',
  expiresAt: 1787399861032,
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate((session) => {
  sessionStorage.setItem('mindSession', JSON.stringify(session));
}, SESSION);
await page.reload({ waitUntil: 'domcontentloaded' });

// Open the Neural Canvas Producer panel, send a message, confirm label shows "Adam".
const textarea = page.locator('textarea[aria-label="Describe your film"]').first();
await textarea.waitFor({ timeout: 10000 });
await textarea.click();
await page.waitForTimeout(2000);

const bodyText = await page.locator('body').innerText();
console.log('Header shows Connected · Adam:', bodyText.includes('Connected · Adam'));

const producerForm = page.locator('form:has(input[aria-label="Direct the film…"])').first();
const producerInput = producerForm.locator('input[aria-label="Direct the film…"]').first();
await producerInput.fill('mindName display test');
await producerForm.locator('button[aria-label="Generate"]').first().click();
await page.waitForTimeout(1500);

const duringSend = await page.locator('body').innerText();
console.log('Elapsed-notice shows "Adam" while waiting:', duringSend.includes('Adam'));
console.log('No longer shows generic "The mind":', !duringSend.includes('The mind'));

await page.screenshot({ path: '/tmp/mindname-display.png' });
await browser.close();
