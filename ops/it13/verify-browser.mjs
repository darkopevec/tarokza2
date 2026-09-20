import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Read-only public browser checks. No tables or games are created.
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
});
try {
  for (const host of ['tarok.moonlitgarden.cc', 'tarok.moonlitgarden.xyz']) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.securityViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        window.securityViolations.push({ directive: event.violatedDirective, uri: event.blockedURI });
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const websocket = page.waitForEvent('websocket', { timeout: 15000 });
    const response = await page.goto(`https://${host}`, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    const socket = await websocket;
    assert.match(socket.url(), /^wss:/);
    await page.waitForTimeout(1000);
    assert.deepEqual(await page.evaluate(() => window.securityViolations), []);
    assert.deepEqual(errors, []);
    const headers = response.headers();
    assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['strict-transport-security'], 'max-age=31536000');
    console.log(`${host}: browser rendering, CSP and secure WebSocket checked`);
    await context.close();
  }
} finally {
  await browser.close();
}
