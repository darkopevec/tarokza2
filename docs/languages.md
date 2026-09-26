# Languages

The language selector is available on the home screen, waiting table and game screen. Language priority is: an explicit saved choice, the country detected from the visitor's IP, the first supported browser language, then English. For example, a Slovenian IP defaults to Slovenian even when the browser uses English. Switzerland, Belgium and Canada use the browser preference to choose among their supported languages, with German, French and English as their respective defaults. Spanish-speaking countries also default to Spanish.

An explicit choice is saved locally under `tarokza2.language`. Storage being unavailable does not prevent switching languages. The preference belongs to the browser, so opponents can use different languages at the same table. An inferred country default is not saved, and a delayed lookup never overrides a manual choice. The first screen renders immediately using the browser language; the country lookup has a 1.5-second timeout and retains that fallback on failure. Regional browser variants such as `es-MX` and `de-AT` are supported.

Changing language updates visible text, accessible labels, card names, rules, saved score explanations, errors, date formatting, page title and document language. It does not alter card IDs, bids, scoring, saved games or player-entered names. Card artwork retains the original printed deck.

The header shows the selected language as a compact flag with a 44px touch
target. The native menu retains full language names and keyboard navigation.
Flags are local SVGs from flag-icons; their attribution and MIT license are in
[`public/flags/`](../public/flags/README.md).

## IP country detection

`GET /api/locale` returns only `{ "country": "SI" }` (or `null` for an unknown country) with `Cache-Control: private, no-store`. The server uses the local IPv4/IPv6 database bundled with `geoip-country`. There are no external lookup requests, API keys or location permission prompts. This feature does not log or persist visitor IPs. Private/LAN, loopback and reserved addresses fall back to browser preferences. An IP country is approximate and can reflect a VPN or proxy's location; the language selector always remains available.

Reverse proxies use the same `TRUSTED_PROXIES` configuration as the existing connection controls. Leave it empty for direct hosting; behind a proxy, list its exact source IPs or narrow CIDRs and have it sanitize `X-Forwarded-For`. Arbitrary forwarding headers, country headers and query parameters are ignored. The supplied nginx/IT13 configuration already forwards the real client address. Vite proxies `/api` to the local game server during development.

The country database ships in the production dependency and is read locally, including in the read-only Docker image. Refresh it with `npm install --save-exact geoip-country@latest`, run the checks, then rebuild and redeploy. This product includes GeoLite2 data created by [MaxMind](https://www.maxmind.com/), distributed by [geoip-country](https://github.com/sapics/geoip-country). The package retains its LICENSE and EULA files.

## Coverage

| Language | Tarok/tarot-playing countries covered |
| --- | --- |
| Slovenian | Slovenia |
| German | Austria, Germany and German-speaking Switzerland |
| French | France and French-speaking Switzerland |
| Italian | Italy and Italian-speaking Switzerland |
| Czech | Czechia |
| Slovak | Slovakia |
| Hungarian | Hungary |
| Danish | Denmark |
| Romanian | Romania |
| Polish | Southern Poland |
| English, Spanish | Explicitly requested additional languages |

The selection uses Pagat's [survey of tarot card games](https://www.pagat.com/tarot/) and its account of [Taroky and Polish Taroki](https://www.pagat.com/tarot/taroky.html), checked on 25 September 2026. These countries play different members of the tarok/tarock/tarot family. Language selection translates TarokZa2's Slovenian Napoleon rules; it does not select a national rules variant.

## Maintaining translations

`src/i18n.mjs` provides locale selection, interpolation, pluralized trick counts, canonical card-name translation and document metadata. Components explicitly translate text at the presentation boundary. Server error strings are translated when displayed, which also lets an existing notification update when the player switches language.

Slovenian source strings are stable translation keys. `src/locales/en.json` is the complete reference catalog; each other locale JSON must contain the same keys and preserve named placeholders such as `{player}` and `{count}`. Pass variable values as interpolation parameters rather than translating player names or combining sentence fragments. Render interpolated text with React, not as HTML. Keep card strengths, scoring formulas and protocol identifiers independent of translated labels.

The additional catalogs were initially machine translated, then reviewed for card-game terminology and rules. Native-speaker improvements are welcome, especially for regional tarok vocabulary. Translation catalogs ship with the app; gameplay never requests an external translation service.

Run `npm test`, `npm run build` and `npm run test:language` after changes. Tests cover IPv4/IPv6 country lookup, trusted proxy boundaries, cache headers, country defaults, multilingual countries, saved preferences, late-response races, lookup failure and timeout. The language browser check starts a disposable local server and uses separate English and Spanish players; it also checks all language choices at a narrow phone width, translated errors, cards, rules and saved score explanations. Existing browser checks explicitly use Slovenian on local connections so their expected labels remain stable.
