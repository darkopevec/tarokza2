import { cardFor, createDeck } from '../shared/cards.mjs';

export const DECK_STORAGE_KEY = 'tarokza2.deck';
export const DEFAULT_DECK = 'modiano';
export const CARD_DECKS = Object.freeze([
  Object.freeze({ id: 'modiano', name: 'Modiano' }),
  Object.freeze({ id: 'slovenian', name: 'Slovenski tarok · Piatnik' }),
  Object.freeze({ id: 'smrekar', name: 'Smrekarjev tarok · Hinko Smrekar' }),
  Object.freeze({ id: 'moser', name: 'Secesijski tarok · Ditha Moser' }),
  Object.freeze({ id: 'cego', name: 'Adler-Cego · ASS' }),
  Object.freeze({ id: 'neumayer', name: 'Češki tarok · OTK' }),
]);
const deckIds = new Set(CARD_DECKS.map(deck => deck.id));
const validDeck = value => deckIds.has(value) ? value : DEFAULT_DECK;

// The shared Ornament back has not changed with the Modiano face restoration.
export const CARD_BACK_IMAGE = '/cards/back-ornament.png?v=1';
const artwork = {
  slovenian: { version: 1, pips: createDeck().filter(card => card.suit !== 'tarok' && card.rank <= 4).map(card => card.id) },
  smrekar: { version: 2, back: true, pips: createDeck().filter(card => card.suit !== 'tarok' && card.rank <= 4 && !['diamonds-4', 'clubs-1', 'spades-1'].includes(card.id)).map(card => card.id) },
  moser: { version: 1, back: true, pips: [] },
  cego: { version: 1, back: true, pips: ['clubs-1', 'clubs-2', 'clubs-3', 'spades-1', 'spades-2', 'spades-3', 'hearts-1', 'hearts-2', 'diamonds-1', 'diamonds-2'] },
  neumayer: { version: 1, back: true, pips: createDeck().filter(card => card.suit !== 'tarok' && card.rank <= 4).map(card => card.id) },
};

export function cardBackImage(deck = selectedDeck) {
  const selected = validDeck(deck), pack = artwork[selected];
  return pack?.back ? `/cards/${selected}/back.jpg?v=${pack.version}` : CARD_BACK_IMAGE;
}

/** Artwork is a browser preference; canonical card metadata and game saves stay unchanged. */
export function cardImage(value, deck = selectedDeck) {
  const card = cardFor(typeof value === 'string' ? value : value?.id);
  if (!card) return null;
  const selected = validDeck(deck);
  if (selected === 'modiano') return card.image;
  const pack = artwork[selected];
  return `/cards/${selected}/${card.id}.${pack.pips.includes(card.id) ? 'svg' : 'jpg'}?v=${pack.version}`;
}

export function cardImageUrls(deck = selectedDeck) {
  return [cardBackImage(deck), ...createDeck().map(card => cardImage(card, deck))];
}

function savedDeck() {
  try { return validDeck(window.localStorage.getItem(DECK_STORAGE_KEY)); }
  catch { return DEFAULT_DECK; }
}

let selectedDeck = savedDeck();
const listeners = new Set();
export const getDeck = () => selectedDeck;
export const subscribeDeck = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function applyDeck(deck) {
  if (selectedDeck === deck) return;
  selectedDeck = deck;
  listeners.forEach(listener => listener());
}

export function setDeck(deck) {
  if (!deckIds.has(deck)) return;
  try { window.localStorage.setItem(DECK_STORAGE_KEY, deck); }
  catch { /* The choice still works for this visit when storage is unavailable. */ }
  applyDeck(deck);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === DECK_STORAGE_KEY || event.key === null) applyDeck(validDeck(event.newValue));
  });
}
