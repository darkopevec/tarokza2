import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeck } from '../shared/cards.mjs';
import { CARD_BACK_IMAGE, CARD_DECKS, cardImage, cardImageUrls } from '../src/decks.mjs';

async function fixture(t, { saved = null, blocked = false } = {}) {
  const original = globalThis.window;
  const storage = new Map(saved === null ? [] : [['tarokza2.deck', saved]]);
  const handlers = new Map();
  globalThis.window = {
    localStorage: {
      getItem(key) { if (blocked) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw new Error('Storage unavailable'); storage.set(key, value); },
    },
    addEventListener(type, handler) { handlers.set(type, handler); },
  };
  t.after(() => {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  });
  return {
    ...await import(`../src/decks.mjs?test=${Math.random()}`), storage,
    storageEvent: event => handlers.get('storage')(event),
  };
}

test('each deck maps the same 54 identities to unique local artwork without changing game metadata', () => {
  const cards = createDeck();
  const before = structuredClone(cards);
  for (const { id } of CARD_DECKS) {
    const urls = cardImageUrls(id);
    assert.equal(urls.length, 55);
    assert.equal(new Set(urls).size, 55);
    assert.equal(urls[0], CARD_BACK_IMAGE);
    for (const card of cards) {
      assert.equal(cardImage(card, id), cardImage(card.id, id));
      assert.ok(urls.includes(cardImage(card, id)));
      if (id === 'modiano') assert.equal(cardImage(card, id), card.image);
      else assert.equal(cardImage(card, id), `/cards/slovenian/${card.id}.${card.suit !== 'tarok' && card.rank <= 4 ? 'svg' : 'jpg'}?v=1`);
    }
  }
  assert.equal(cardImageUrls('slovenian').filter(url => url.includes('.svg?')).length, 16);
  assert.deepEqual(cards, before);
  assert.deepEqual(createDeck(), before);
  assert.equal(cardImage('../secret'), null);
  assert.equal(cardImage('toString'), null);
  assert.equal(cardImage(null), null);
  assert.equal(cardImage('tarok-1', 'unknown'), cardImage('tarok-1', 'modiano'));
});

test('Modiano remains the default and a chosen deck persists for this browser', async t => {
  const f = await fixture(t);
  assert.equal(f.getDeck(), 'modiano');
  let updates = 0;
  const unsubscribe = f.subscribeDeck(() => updates++);
  f.setDeck('slovenian');
  assert.equal(f.getDeck(), 'slovenian');
  assert.equal(f.storage.get(f.DECK_STORAGE_KEY), 'slovenian');
  assert.match(f.cardImage('tarok-1'), /^\/cards\/slovenian\//);
  assert.equal(updates, 1);
  f.setDeck('slovenian');
  f.setDeck('invalid');
  assert.equal(updates, 1);
  assert.equal(f.getDeck(), 'slovenian');
  unsubscribe();
  f.setDeck('modiano');
  assert.equal(updates, 1);
});

test('saved preferences restore', async t => {
  const restored = await fixture(t, { saved: 'slovenian' });
  assert.equal(restored.getDeck(), 'slovenian');
});

test('corrupt preferences retain the existing default', async t => {
  const corrupt = await fixture(t, { saved: '__proto__' });
  assert.equal(corrupt.getDeck(), 'modiano');
});

test('selection works without browser storage and follows changes made in another tab', async t => {
  const f = await fixture(t, { blocked: true });
  assert.equal(f.getDeck(), 'modiano');
  f.setDeck('slovenian');
  assert.equal(f.getDeck(), 'slovenian');
  f.storageEvent({ key: 'unrelated', newValue: 'modiano' });
  assert.equal(f.getDeck(), 'slovenian');
  f.storageEvent({ key: f.DECK_STORAGE_KEY, newValue: 'modiano' });
  assert.equal(f.getDeck(), 'modiano');
  f.storageEvent({ key: f.DECK_STORAGE_KEY, newValue: 'slovenian' });
  assert.equal(f.getDeck(), 'slovenian');
  f.storageEvent({ key: f.DECK_STORAGE_KEY, newValue: null });
  assert.equal(f.getDeck(), 'modiano');
  f.setDeck('slovenian');
  f.storageEvent({ key: null, newValue: null });
  assert.equal(f.getDeck(), 'modiano');
});
