import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { detectLanguage, LANGUAGE_STORAGE_KEY, translatorFor } from '../../src/i18n.mjs';

// Read-only public browser checks. No identities, tables or games are created.
// Language changes only update storage in this disposable browser context.
const languageCodes = ['sl', 'en', 'es', 'de', 'fr', 'it', 'cs', 'sk', 'hu', 'da', 'ro', 'pl'];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
});
try {
  for (const host of ['tarok.moonlitgarden.cc', 'tarok.moonlitgarden.xyz']) {
    const context = await browser.newContext({ locale: 'en-US' });
    await context.addInitScript(() => {
      window.securityViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        window.securityViolations.push({ directive: event.violatedDirective, uri: event.blockedURI });
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const websocket = page.waitForEvent('websocket', { timeout: 15000 });
    const localeResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/locale');
    const response = await page.goto(`https://${host}`, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    const socket = await websocket;
    assert.match(socket.url(), /^wss:/);
    const detectedResponse = await localeResponse;
    assert.equal(detectedResponse.status(), 200);
    const detected = await detectedResponse.json();
    assert.deepEqual(Object.keys(detected), ['country']);
    assert.ok(detected.country === null || /^[A-Z]{2}$/.test(detected.country));
    const cacheControl = detectedResponse.headers()['cache-control'].split(',').map(value => value.trim().toLowerCase());
    assert.ok(cacheControl.includes('private') && cacheControl.includes('no-store'));
    const preferred = await page.evaluate(() => navigator.languages);
    const defaultLanguage = detectLanguage(null, preferred, detected.country);
    const selector = page.getByTestId('language-select');
    await expect(selector).toBeVisible();
    assert.deepEqual(await selector.locator('option').evaluateAll(options => options.map(option => option.value)), languageCodes);
    await expect(selector).toHaveValue(defaultLanguage);
    await expect(page.locator('html')).toHaveAttribute('lang', defaultLanguage);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_STORAGE_KEY), null);
    for (const code of languageCodes) {
      await selector.selectOption(code);
      await expect(selector).toHaveValue(code);
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(page).toHaveTitle(translatorFor(code)('TarokZa2 · Dobra družba. Dobre karte.'));
    }
    const explicitLanguage = defaultLanguage === 'es' ? 'en' : 'es';
    await selector.selectOption(explicitLanguage);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_STORAGE_KEY), explicitLanguage);
    assert.deepEqual(await page.evaluate(() => window.securityViolations), []);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(selector).toHaveValue(explicitLanguage);
    await expect(page.locator('html')).toHaveAttribute('lang', explicitLanguage);
    await expect(page).toHaveTitle(translatorFor(explicitLanguage)('TarokZa2 · Dobra družba. Dobre karte.'));
    assert.deepEqual(await page.evaluate(() => window.securityViolations), []);
    assert.deepEqual(errors, []);
    const headers = response.headers();
    assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['strict-transport-security'], 'max-age=31536000');
    console.log(`${host}: 12 languages, IP/browser default (${defaultLanguage}), saved choice, CSP and secure WebSocket checked`);
    await context.close();
  }
} finally {
  await browser.close();
}
