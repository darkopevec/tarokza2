import en from './locales/en.json' with { type: 'json' };
import es from './locales/es.json' with { type: 'json' };
import de from './locales/de.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };
import it from './locales/it.json' with { type: 'json' };
import cs from './locales/cs.json' with { type: 'json' };
import sk from './locales/sk.json' with { type: 'json' };
import hu from './locales/hu.json' with { type: 'json' };
import da from './locales/da.json' with { type: 'json' };
import ro from './locales/ro.json' with { type: 'json' };
import pl from './locales/pl.json' with { type: 'json' };
import { cardFor } from '../shared/cards.mjs';

export const LANGUAGE_STORAGE_KEY = 'tarokza2.language';
export const LOCALE_LOOKUP_TIMEOUT_MS = 1500;
export const languages = Object.freeze([
  { code: 'sl', name: 'Slovenščina', flag: 'si' },
  { code: 'en', name: 'English', flag: 'gb' },
  { code: 'es', name: 'Español', flag: 'es' },
  { code: 'de', name: 'Deutsch', flag: 'de' },
  { code: 'fr', name: 'Français', flag: 'fr' },
  { code: 'it', name: 'Italiano', flag: 'it' },
  { code: 'cs', name: 'Čeština', flag: 'cz' },
  { code: 'sk', name: 'Slovenčina', flag: 'sk' },
  { code: 'hu', name: 'Magyar', flag: 'hu' },
  { code: 'da', name: 'Dansk', flag: 'dk' },
  { code: 'ro', name: 'Română', flag: 'ro' },
  { code: 'pl', name: 'Polski', flag: 'pl' },
]);
export const catalogs = Object.freeze({ en, es, de, fr, it, cs, sk, hu, da, ro, pl });
const codes = new Set(languages.map(language => language.code));
const baseLanguage = value => typeof value === 'string' ? value.toLowerCase().split(/[-_]/)[0] : '';
const countryLanguages = Object.freeze({
  ...Object.fromEntries([
    ['sl', ['SI']],
    ['de', ['AT', 'DE', 'LI']],
    ['fr', ['FR', 'MC']],
    ['it', ['IT', 'SM', 'VA']],
    ['cs', ['CZ']],
    ['sk', ['SK']],
    ['hu', ['HU']],
    ['da', ['DK']],
    ['ro', ['RO', 'MD']],
    ['pl', ['PL']],
    ['es', ['ES', 'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'SV', 'GQ', 'GT', 'HN', 'MX', 'NI', 'PA', 'PY', 'PE', 'PR', 'UY', 'VE']],
    ['en', ['US', 'GB', 'IE', 'AU', 'NZ']],
  ].flatMap(([language, countries]) => countries.map(country => [country, [language]]))),
  CH: ['de', 'fr', 'it'],
  BE: ['fr', 'de'],
  CA: ['en', 'fr'],
});

/** Browser preferences resolve countries with more than one supported language. */
export function languageForCountry(country, preferred = []) {
  if (typeof country !== 'string') return null;
  const choices = Object.hasOwn(countryLanguages, country.trim().toUpperCase())
    ? countryLanguages[country.trim().toUpperCase()] : null;
  if (!choices) return null;
  return preferred.map(baseLanguage).find(code => choices.includes(code)) || choices[0];
}

/** Explicit choice, then IP country, then supported browser language, then English. */
export function detectLanguage(saved, preferred = [], country) {
  if (codes.has(baseLanguage(saved))) return baseLanguage(saved);
  return languageForCountry(country, preferred) || preferred.map(baseLanguage).find(code => codes.has(code)) || 'en';
}

function savedLanguage() {
  try {
    const saved = baseLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
    return codes.has(saved) ? saved : null;
  } catch { return null; /* Storage can be disabled. */ }
}

const browserLanguages = () => window.navigator.languages || [window.navigator.language];
function initialLanguage() {
  if (typeof window === 'undefined') return 'sl';
  return detectLanguage(savedLanguage(), browserLanguages());
}

let locale = initialLanguage();
let choiceRevision = 0;
let localeLookup;
const listeners = new Set();
export const getLocale = () => locale;
export const subscribeLocale = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function translatorFor(language) {
  const code = codes.has(baseLanguage(language)) ? baseLanguage(language) : 'en';
  return (source, params = {}) => {
    const catalog = catalogs[code];
    const template = code === 'sl' ? source : Object.hasOwn(catalog, source) ? catalog[source]
      : Object.hasOwn(en, source) ? en[source] : source;
    return template.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(params, key) ? String(params[key]) : match);
  };
}
export const t = (source, params) => translatorFor(locale)(source, params);

function updateDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.title = t('TarokZa2 · Dobra družba. Dobre karte.');
  document.querySelector('meta[name="description"]')?.setAttribute('content',
    t('TarokZa2 — slovenski tarok za dva. Ustvari mizo, povabi prijatelja in odigraj svojo naslednjo dobro partijo.'));
}

function applyLocale(language) {
  if (locale === language) return;
  locale = language;
  updateDocument();
  listeners.forEach(listener => listener());
}

export function setLocale(language) {
  if (!codes.has(language)) return;
  // Even selecting the current language is an explicit choice, including when storage is unavailable.
  choiceRevision++;
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* Still switch for this visit. */ }
  applyLocale(language);
}

/** Resolve the visitor's country once without delaying the first render or saving an inferred choice. */
export function initializeLocale() {
  if (typeof window === 'undefined') return Promise.resolve(locale);
  if (localeLookup) return localeLookup;
  if (savedLanguage() || choiceRevision > 0) return localeLookup = Promise.resolve(locale);
  const revision = choiceRevision;
  localeLookup = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOCALE_LOOKUP_TIMEOUT_MS);
    try {
      const response = await window.fetch('/api/locale', {
        signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
      });
      if (!response.ok) return locale;
      const result = await response.json();
      const detected = languageForCountry(result?.country, browserLanguages());
      if (detected && !controller.signal.aborted && revision === choiceRevision && !savedLanguage()) {
        applyLocale(detected);
      }
    } catch { /* Keep the browser default when country detection is unavailable. */ }
    finally { clearTimeout(timeout); }
    return locale;
  })();
  return localeLookup;
}

// Localize protocol text at the presentation boundary, preserving the shared game.
export const translateMessage = message => typeof message === 'string' ? t(message) : message;

export function cardName(value, language = locale) {
  const card = cardFor(typeof value === 'string' ? value : value?.id) || value;
  if (!card || typeof card !== 'object') return '';
  const translate = translatorFor(language);
  if (card.suit === 'tarok' && card.rank > 1 && card.rank < 21) {
    return translate('Tarok {rank}', { rank: card.label });
  }
  return translate(card.name || card.label || '');
}

export function trickCountLabel(count, language = locale) {
  const category = new Intl.PluralRules(language).select(count);
  const key = { one: '{count} štih', two: '{count} štiha', few: '{count} štihi' }[category] || '{count} štihov';
  return translatorFor(language)(key, { count: new Intl.NumberFormat(language).format(count) });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== LANGUAGE_STORAGE_KEY || !codes.has(event.newValue)) return;
    choiceRevision++;
    applyLocale(event.newValue);
  });
  updateDocument();
  void initializeLocale();
}
