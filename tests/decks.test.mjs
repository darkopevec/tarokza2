import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeck } from '../shared/cards.mjs';
import { CARD_BACK_IMAGE, CARD_DECKS, cardBackImage, cardImage, cardImageUrls } from '../src/decks.mjs';

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
    assert.equal(urls[0], cardBackImage(id));
    for (const card of cards) {
      assert.equal(cardImage(card, id), cardImage(card.id, id));
      assert.ok(urls.includes(cardImage(card, id)));
      if (id === 'modiano') assert.equal(cardImage(card, id), card.image);
      else {
        const reconstructed = card.suit !== 'tarok' && card.rank <= 4
          && (id !== 'smrekar' || !['diamonds-4', 'clubs-1', 'spades-1'].includes(card.id));
        assert.equal(cardImage(card, id), `/cards/${id}/${card.id}.${reconstructed ? 'svg' : 'jpg'}?v=${id === 'smrekar' ? 2 : 1}`);
      }
    }
  }
  assert.equal(cardImageUrls('slovenian').filter(url => url.includes('.svg?')).length, 16);
  assert.equal(cardImageUrls('smrekar').filter(url => url.includes('.svg?')).length, 13);
  assert.equal(cardImageUrls('smrekar').filter(url => url.includes('.jpg?')).length, 42);
  assert.deepEqual(cards, before);
  assert.deepEqual(createDeck(), before);
  assert.equal(cardImage('../secret'), null);
  assert.equal(cardImage('toString'), null);
  assert.equal(cardImage(null), null);
  assert.equal(cardImage('tarok-1', 'unknown'), cardImage('tarok-1', 'modiano'));
});

test('Smrekar uses its original back and the existing decks keep their shared back', () => {
  assert.equal(cardBackImage('smrekar'), '/cards/smrekar/back.jpg?v=2');
  assert.equal(cardBackImage('modiano'), CARD_BACK_IMAGE);
  assert.equal(cardBackImage('slovenian'), CARD_BACK_IMAGE);
  assert.equal(cardBackImage('unknown'), CARD_BACK_IMAGE);
});

test('all Smrekar faces and its back use the corrected artwork revision', () => {
  assert.ok(cardImageUrls('smrekar').every(url => url.endsWith('?v=2')));
  assert.ok(cardImageUrls('slovenian').every(url => url.endsWith('?v=1')));
  assert.ok(cardImageUrls('modiano').every(url => url.endsWith('?v=1')));
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
  f.setDeck('smrekar');
  assert.equal(f.getDeck(), 'smrekar');
  assert.equal(f.storage.get(f.DECK_STORAGE_KEY), 'smrekar');
  assert.match(f.cardImage('tarok-1'), /^\/cards\/smrekar\//);
  assert.equal(f.cardBackImage(), '/cards/smrekar/back.jpg?v=2');
  assert.equal(updates, 2);
  unsubscribe();
  f.setDeck('modiano');
  assert.equal(updates, 2);
});

test('saved preferences restore', async t => {
  for (const { id } of CARD_DECKS) {
    await t.test(id, async t => {
      const restored = await fixture(t, { saved: id });
      assert.equal(restored.getDeck(), id);
      assert.equal(restored.cardBackImage(), cardBackImage(id));
    });
  }
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
  f.storageEvent({ key: f.DECK_STORAGE_KEY, newValue: 'smrekar' });
  assert.equal(f.getDeck(), 'smrekar');
  assert.equal(f.cardBackImage(), '/cards/smrekar/back.jpg?v=2');
  f.storageEvent({ key: f.DECK_STORAGE_KEY, newValue: null });
  assert.equal(f.getDeck(), 'modiano');
  f.setDeck('slovenian');
  f.storageEvent({ key: null, newValue: null });
  assert.equal(f.getDeck(), 'modiano');
});
