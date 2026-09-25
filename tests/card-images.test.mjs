import test from 'node:test';
import assert from 'node:assert/strict';
import { cardBackImage, cardImageUrls } from '../src/decks.mjs';

async function fixture(t, { fail = false } = {}) {
  const original = globalThis.Image;
  const requests = [];
  let active = 0, peak = 0;
  globalThis.Image = class {
    set src(url) {
      requests.push(url);
      active++;
      peak = Math.max(peak, active);
      setTimeout(() => {
        if (fail && url.includes('tarok-1.jpg')) {
          fail = false;
          active--;
          this.onerror();
        } else this.onload();
      }, 1);
    }
    async decode() {
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
    }
  };
  t.after(() => { globalThis.Image = original; });
  const module = await import(`../src/card-images.mjs?test=${Math.random()}`);
  return { ...module, requests, active: () => active, peak: () => peak };
}

test('the complete deck is decoded once, sharing concurrent requests with two background loads', async t => {
  const f = await fixture(t);
  const first = f.prepareCardImages();
  const second = f.prepareCardImages();
  await Promise.all([first, second]);
  assert.equal(f.active(), 0, 'Ready includes image decoding, not only download');
  assert.ok(f.peak() <= 2);
  assert.deepEqual([...f.requests].sort(), [...f.CARD_IMAGE_URLS].sort());
  await f.prepareCardImages();
  assert.equal(f.requests.length, 55);
});

test('a failed image can be retried while already loaded artwork is reused', async t => {
  const f = await fixture(t, { fail: true });
  await f.prepareCardImages();
  await f.prepareCardImages();
  assert.equal(f.active(), 0);
  for (const url of f.CARD_IMAGE_URLS) {
    assert.equal(f.requests.filter(request => request === url).length, url.includes('tarok-1.jpg') ? 2 : 1);
  }
});

test('visible cards finish before background artwork starts', async t => {
  const f = await fixture(t);
  const visible = f.CARD_IMAGE_URLS.slice(-2);
  const work = f.prepareCardImages(visible);
  assert.deepEqual(f.requests, visible);
  await work;
  assert.deepEqual(f.requests.slice(0, 2), visible);
  assert.equal(new Set(f.requests).size, 55);
});

test('switching decks replaces queued artwork while sharing the back and background workers', async t => {
  const f = await fixture(t);
  const oldWork = f.prepareCardImages([], 'modiano');
  await new Promise(resolve => setTimeout(resolve, 1));
  const requestedBeforeSwitch = f.requests.filter(url => url.includes('/cards/deck/')).length;
  assert.ok(requestedBeforeSwitch < 54);
  await Promise.all([oldWork, f.prepareCardImages([], 'slovenian')]);
  assert.equal(f.requests.filter(url => url.includes('/cards/deck/')).length, requestedBeforeSwitch);
  for (const url of cardImageUrls('slovenian')) assert.ok(f.requests.includes(url), url);
  assert.equal(f.requests.filter(url => url.includes('back-ornament')).length, 1);
  assert.ok(f.peak() <= 2, 'Deck switches retain two shared background workers');
  assert.equal(f.active(), 0);
  await f.prepareCardImages([], 'modiano');
  for (const url of cardImageUrls('modiano')) assert.ok(f.requests.includes(url), url);
  assert.equal(f.requests.length, 109, 'Returning to an earlier deck reuses its loaded artwork');
});

test('rapid repeated changes complete the final selected deck without warming intermediate choices', async t => {
  const f = await fixture(t);
  await Promise.all([
    f.prepareCardImages([], 'slovenian'),
    f.prepareCardImages([], 'modiano'),
    f.prepareCardImages([], 'smrekar'),
  ]);
  assert.deepEqual([...f.requests].sort(), cardImageUrls('smrekar').sort());
  assert.equal(f.active(), 0);
});

test('switching to Smrekar warms its original back once and reuses both decks on return', async t => {
  const f = await fixture(t);
  await f.prepareCardImages([], 'modiano');
  await f.prepareCardImages([cardBackImage('smrekar')], 'smrekar');
  assert.equal(f.requests[55], cardBackImage('smrekar'), 'A visible Smrekar back is prepared first');
  assert.equal(f.requests.length, 110, 'Each deck has its own back and 54 faces');
  for (const url of cardImageUrls('smrekar')) assert.ok(f.requests.includes(url), url);
  await f.prepareCardImages([], 'modiano');
  await f.prepareCardImages([], 'smrekar');
  assert.equal(f.requests.length, 110, 'Revisiting either deck reuses decoded faces and backs');
  assert.equal(f.requests.filter(url => url === cardBackImage('smrekar')).length, 1);
  assert.equal(f.requests.filter(url => url === cardBackImage('modiano')).length, 1);
  assert.equal(f.active(), 0);
  assert.ok(f.peak() <= 2);
});
