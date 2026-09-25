import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDeck } from '../shared/cards.mjs';
import {
  cardName, catalogs, detectLanguage, getLocale, languageForCountry, languages, setLocale,
  subscribeLocale, translateMessage, translatorFor, trickCountLabel,
} from '../src/i18n.mjs';

const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('language detection respects saved preferences and supported browser language order', () => {
  assert.equal(detectLanguage('de', ['es-MX', 'en-GB']), 'de');
  assert.equal(detectLanguage('PT', ['ja-JP', 'es-MX', 'en-GB']), 'es');
  assert.equal(detectLanguage(null, ['sl-SI', 'en-US']), 'sl');
  assert.equal(detectLanguage(undefined, ['DE_at']), 'de');
  assert.equal(detectLanguage('EN-us', ['sl-SI']), 'en');
  assert.equal(detectLanguage(null, ['ja-JP', 'pt-BR']), 'en');
  assert.equal(detectLanguage(undefined), 'en');
});

test('IP country defaults take priority over the browser, while saved choices always win', () => {
  for (const [country, language] of Object.entries({
    SI: 'sl', AT: 'de', DE: 'de', LI: 'de', FR: 'fr', MC: 'fr', IT: 'it', SM: 'it', VA: 'it',
    CZ: 'cs', SK: 'sk', HU: 'hu', DK: 'da', RO: 'ro', MD: 'ro', PL: 'pl',
    ES: 'es', AR: 'es', BO: 'es', CL: 'es', CO: 'es', CR: 'es', CU: 'es', DO: 'es', EC: 'es',
    SV: 'es', GQ: 'es', GT: 'es', HN: 'es', MX: 'es', NI: 'es', PA: 'es', PY: 'es', PE: 'es', PR: 'es', UY: 'es', VE: 'es',
    US: 'en', GB: 'en', IE: 'en', AU: 'en', NZ: 'en',
  })) {
    assert.equal(detectLanguage(null, ['ja-JP', 'fr-FR'], country), language, country);
    assert.equal(detectLanguage('pl', ['ja-JP', 'fr-FR'], country), 'pl', `${country}: explicit choice wins`);
  }
  assert.equal(detectLanguage('invalid', ['en-US'], 'si'), 'sl');
  assert.equal(detectLanguage(null, ['es-MX'], 'JP'), 'es');
  assert.equal(detectLanguage(null, ['ja-JP'], 'JP'), 'en');
  for (const country of [null, undefined, '', '??', '__proto__', 'toString', {}, 42]) {
    assert.equal(languageForCountry(country, ['fr-FR']), null);
    assert.equal(detectLanguage(null, ['de-DE'], country), 'de');
  }
});

test('multilingual countries use matching browser preferences before their country default', () => {
  assert.equal(languageForCountry('CH', ['es-ES', 'it-CH', 'fr-CH']), 'it');
  assert.equal(languageForCountry(' ch ', ['fr-CH', 'de-CH']), 'fr');
  assert.equal(languageForCountry('CH', ['en-US']), 'de');
  assert.equal(languageForCountry('BE', ['nl-BE', 'de-BE', 'fr-BE']), 'de');
  assert.equal(languageForCountry('BE', ['nl-BE']), 'fr');
  assert.equal(languageForCountry('CA', ['fr-CA', 'en-CA']), 'fr');
  assert.equal(languageForCountry('CA', ['es-MX']), 'en');
  assert.equal(detectLanguage('sl', ['fr-CA'], 'CA'), 'sl');
});

test('each supported translation has complete keys and preserves every interpolation parameter', () => {
  const expected = Object.keys(catalogs.en).sort();
  assert.ok(expected.length > 100, 'The catalogue must cover the game, rules and identity flows.');
  for (const { code } of languages.filter(language => language.code !== 'sl')) {
    const catalog = catalogs[code];
    assert.deepEqual(Object.keys(catalog).sort(), expected, `${code}: missing or extra translation keys`);
    for (const source of expected) {
      assert.equal(typeof catalog[source], 'string', `${code}: ${source}`);
      assert.ok(catalog[source].trim(), `${code}: empty translation for ${source}`);
      assert.deepEqual(placeholders(catalog[source]), placeholders(source), `${code}: interpolation changed for ${source}`);
    }
  }
});

test('translation interpolates user data once and safely falls back for unknown keys and languages', () => {
  const en = translatorFor('en');
  assert.equal(en('Igraš kot {name}.', { name: 'Ana {room} $& <b>' }), 'You are playing as Ana {room} $& <b>.');
  assert.equal(en('Igraš kot {name}.'), 'You are playing as {name}.');
  assert.equal(translatorFor('sl')('Igraš kot {name}.', { name: 'Ana' }), 'Igraš kot Ana.');
  assert.equal(translatorFor('unsupported')('Brskalnik'), 'Browser');
  assert.equal(en('Unknown source {number}', { number: 0 }), 'Unknown source 0');
  assert.equal(en('Unknown source'), 'Unknown source');
  assert.equal(en('toString'), 'toString');
  assert.equal(en('__proto__'), '__proto__');
});

test('every backend user error is covered by every language', async () => {
  for (const file of ['../server/index.mjs', '../server/identity.mjs', '../shared/game.mjs']) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8');
    for (const [, message] of text.matchAll(/(?:new (?:RequestError|IdentityError|Error)\(|fail\(|error: )'([^']+)'/g)) {
      if (message === 'Invalid room record') continue; // Internal persistence validation; never sent to a player.
      assert.ok(Object.hasOwn(catalogs.en, message), `${file}: unmapped error ${message}`);
      for (const [code, catalog] of Object.entries(catalogs)) {
        assert.ok(Object.hasOwn(catalog, message), `${code}: untranslated error ${message}`);
      }
    }
  }
});

test('card names translate all 54 cards without changing canonical metadata or game values', () => {
  const deck = createDeck();
  const before = structuredClone(deck);
  for (const { code } of languages) {
    for (const card of deck) {
      const name = cardName(card, code);
      assert.ok(name, `${code}: no name for ${card.id}`);
      assert.ok(!/\{\w+\}/.test(name), `${code}: unresolved name for ${card.id}`);
      assert.equal(cardName(card.id, code), name);
      if (code === 'sl') assert.equal(name, card.name);
    }
  }
  assert.equal(cardName('clubs-8', 'en'), 'King of clubs');
  assert.equal(cardName('tarok-2', 'en'), 'Trump II');
  assert.notEqual(cardName('clubs-8', 'es'), cardName('clubs-8', 'sl'));
  assert.equal(cardName(null, 'en'), '');
  assert.deepEqual(deck, before);
  assert.deepEqual(createDeck(), before);
});

test('trick counts use Slovenian dual and each language’s plural rules', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 101, 102].map(count => trickCountLabel(count, 'sl')),
    ['0 štihov', '1 štih', '2 štiha', '3 štihi', '4 štihi', '5 štihov', '101 štih', '102 štiha']);
  assert.deepEqual([0, 1, 2].map(count => trickCountLabel(count, 'en')), ['0 tricks', '1 trick', '2 tricks']);
  for (const { code } of languages) {
    for (const count of [0, 1, 2, 3, 5, 21, 27, 101, 1000]) {
      const label = trickCountLabel(count, code);
      assert.ok(label.includes(new Intl.NumberFormat(code).format(count)), `${code}: missing localized count`);
      assert.ok(!/\{\w+\}/.test(label), `${code}: unresolved plural parameter`);
      if (code !== 'sl') assert.ok(!/štih/.test(label), `${code}: Slovenian plural leaked`);
    }
  }
});

test('language subscribers rerender messages once per change and can unsubscribe', () => {
  const initial = getLocale();
  const changes = [];
  const unsubscribe = subscribeLocale(() => changes.push(getLocale()));
  try {
    setLocale('es');
    setLocale('es');
    assert.deepEqual(changes, initial === 'es' ? [] : ['es']);
    const message = 'Povabilo ni veljavno ali je že uporabljeno.';
    assert.equal(translateMessage(message), catalogs.es[message]);
    assert.equal(translateMessage(null), null);
    setLocale('not-supported');
    assert.equal(getLocale(), 'es');
    unsubscribe();
    setLocale('en');
    assert.deepEqual(changes, initial === 'es' ? [] : ['es']);
    assert.equal(translateMessage(message), catalogs.en[message]);
  } finally {
    unsubscribe();
    setLocale(initial);
  }
});
