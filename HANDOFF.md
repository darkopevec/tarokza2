# TarokZa2 — agent handoff

Snapshot: 2026-09-05. Baseline `8a43286` on `main` is pushed to `git@github.com:darkopevec/tarokza2.git`. All six review improvements are implemented: stale-play protection, invitation-first joining, touch-accessible preparation help, accessibility/reflow, historical score explanations, and hosting safeguards. Check Git status before editing; preserve unrelated work.

## Start here

- [README](README.md): running, verification, project structure.
- [Agreed rules](docs/rules.md): authoritative project variant; do not replace user decisions with generic tarok rules.
- [Deployment](docs/deployment.md) and [card provenance](docs/cards.md).
- React/Vite UI: `src/main.jsx`, `src/responsive.css`; rules/private views: `shared/game.mjs`; cards: `shared/cards.mjs`; Socket.IO/persistence: `server/index.mjs`. Historical explanations and creation quotas have separate helpers and tests.

## User decisions to preserve

- Mobile/tablet first, Slovenian copy: **štih**, **Igraš?**. Real 54-card scans, no added A/C/D/F shorthand; card width:height is **63:113**, with the user's Piatnik ornamental back.
- Exposed taroks/kings may be taken into the hand **optionally, one card at a time**, including off-turn during play. Never automatically collect newly exposed honors. Pickup is distinct from playing a pile card and consumes no turn.
- Both players confirm preparation before the first play; own confirmation locks choices until play starts.
- Kralji/trula calls require the full set **in hand**; success is judged from captured cards. Silent sets +10, called sets ±20. Valat may be called when all own cards are visible, including up to three uncollected pile tops; silent +250, called ±500, replacing base/set scores. Mondfang −21 remains separate.
- Never recalculate saved score history or upgrade an underway legacy round mid-game. `expectedPlay: {round, trickNumber, trickSize}` must reflect the displayed position and be checked inside the server room queue; optional pickups must not invalidate it.

## Verify safely

Node 22+ via mise; this machine is Omarchy with `/usr/bin/chromium` and passwordless `sudo -n docker`.

```sh
npm test
npm run build
npm run test:score-history
```

For `test:browser` and `test:responsive`, start a disposable `createTarokServer({dataDir})` on loopback with a fresh temporary directory, then set `BASE_URL` and `ARTIFACTS_DIR`. Their default port 3000 is the live app: do not populate or damage its saves for tests. Inspect screenshots, not just assertions; close only browsers/processes you started.

Last checks: **78 tests passed**; two full browser rounds and both players ready for round three. Local evidence: `artifacts/hosting-gameplay/`, `artifacts/hosting-ui/`, `artifacts/score-history/`. Artifacts are Git-ignored, so a fresh clone must regenerate them. Browser coverage is Chromium touch emulation, not physical iOS/Android or native screen-reader testing.

## Operations and remaining caveats

- Local Docker app: `http://localhost:3000`; deploy with `sudo -n docker compose up -d --build`. Preserve the `tarok-data` volume; never use `down --volumes` for routine work.
- Default: **60 new-table attempts/IP/hour** (IPv6 shares a `/64`), not rounds. Shared across reconnects, reset on server restart; joining/resuming/play do not consume this quota. `TRUSTED_PROXIES` is empty by default; configure only actual proxy hops.
- `/health` is liveness; `/ready` reports startup restoration failures. Damaged saves are retained; alert/recover rather than restart-loop or delete. No expiry or total saved-room cap is authorized.
- Single app instance only. Public HTTPS/proxy hosting is not configured; card-back redistribution permission is not documented. Resolve those before broader publication. No further feature is currently requested.
