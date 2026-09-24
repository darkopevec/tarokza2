import test from 'node:test';
import assert from 'node:assert/strict';

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
