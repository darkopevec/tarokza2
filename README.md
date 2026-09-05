# TarokZa2

A mobile and tablet first Slovenian tarok game for two real players. Create a private table, send its invitation link or six-character code, and play in separate browsers. No account is required.

## Run with Docker

```sh
docker compose up -d --build
```

Open **http://localhost:3000**. On another device on your network, open `http://YOUR_COMPUTER_IP:3000`. Create invitations from that address so the other device can follow the link. Internet play requires a reachable host; use an HTTPS reverse proxy that supports WebSocket connections.

```sh
docker compose ps
docker compose logs -f
curl http://localhost:3000/health
docker compose down
```

The container runs as a non-root user. The `tarok-data` volume retains games, seat credentials and scoreboards across restarts. `docker compose down` keeps this volume; removing volumes also removes the saved games. On systems where Docker requires elevated access, prefix Docker commands with `sudo`.

See [deployment details](docs/deployment.md) for port configuration, reverse proxies and backups.

## Play

1. Enter your name and select **Ustvari mizo**.
2. Copy the invitation or room code and share it with your opponent.
3. Your opponent enters their name in the join form and selects **Pridruži se**. Invitation links put joining first and pre-fill the code; missing names or invalid codes get inline feedback. Each browser sees only its own hand and the public table.
4. Bid **Igram** or **Naprej**. The pile tops open for preparation; no cards move into the hand automatically.
5. Optionally take an exposed tarok or king using its **Vzemi v roko** control below the hand. Each click takes exactly one card. The reminder beside **Pripravljen** takes you to these choices without picking anything up. Call **Kralji** or **Trula** only with the full set in hand. **Valat** becomes available when every own pile is empty or has just one face-up card left. The information button explains requirements and points on touch screens; calls are public and final. Both players select **Pripravljen** before any card can be played; your own confirmation locks preparation.
6. Tap a highlighted card to play it on your turn. Swipe the hand horizontally or tap a suit shortcut to find its cards; the shortcuts only scroll your hand. Playing from a pile is distinct from the **Vzemi v roko** action: during play you may still take exposed taroks/kings later, even on the opponent's turn, without consuming a turn.
7. After 27 tricks, both players see the round result with a game/bonus/penalty breakdown and cumulative scoreboard. Select **Nova runda**; a new deal starts after both players are ready.

Refresh or reconnect in the same browser to resume your seat. Leaving a table retains its credential; enter its code or reopen its link to return. Private credentials are stored locally in that browser, so clearing browser storage loses your ability to reclaim a full table. A second device should join as the opponent, not copy another player's browser storage.

Card plays carry the displayed round and trick position. If another tab has already advanced play, the server rejects the outdated request and sends the current table instead of letting that card start the next trick. Optional pickups do not invalidate this position; card legality is still checked against the latest table. After upgrading from an older client, refresh the page if a play asks you to do so. Existing saved rounds and scores do not require migration.

Phone layouts place the two labelled pile groups side by side; landscape phones put the table beside the hand. Tablet layouts use larger card faces. Main touch controls are at least 44px, card proportions remain 63:113, and safe-area padding accounts for screen notches. The hand remains horizontally scrollable; optional pickup/history details can also be reached by scrolling the page vertically on the smallest screens.

## Rules

Uses the Slovenian two-player Napoleon deal and play, with the explicit difference-based scoring in **Tarok.net, chapters 2.1–2.2**. Taking exposed kings and taroks into the hand is **optional**, at any time during play, as confirmed by the user. These choices and the 35–35 edge case are explained in [the rules](docs/rules.md) and the in-game **Kako igrati** dialog.

The agreed two-player additions are silent kings/trula **+10** each, called sets **+20/−20**, silent valat **+250**, called valat **+500/−500**, and **−21 mondfang** for losing Mond to Škis. Valat replaces the base game and set bonuses; mondfang stays separate. Calls require both players to finish preparation before the opening lead. Valat requires all your own cards to be visible, but the final face-up card on each pile may remain there. Saved rounds already underway retain their old scoring until the next fresh deal; earlier score rows are not rewritten.

Each player receives 15 hand cards plus three stacks of four. The server enforces bidding, following suit, mandatory trumping, stack restrictions, and the 27-trick round. Score history persists between rounds. Kings and taroks explicitly taken into the hand are recorded for both players to inspect.

## Local development

Node.js 22 or newer is required. With mise, select a current Node version before installing dependencies.

```sh
npm ci
npm run server
```

In another terminal:

```sh
npm run dev
```

Vite serves the frontend on port 5173 and proxies multiplayer requests to port 3000. For a production run without Docker:

```sh
npm run build
npm start
```

## Verification

```sh
npm test
npm run test:browser
npm run test:responsive
```

The browser verification requires the running app on port 3000. It uses system Chromium when available; otherwise install Playwright Chromium with `npx playwright install chromium`. Set `BASE_URL` to use a different deployment, or `CHROMIUM_EXECUTABLE_PATH` for a different Chromium executable.

To watch the verification and leave both player windows open, ready for round three:

```sh
HEADLESS=0 KEEP_BROWSER_OPEN=1 npm run test:browser
```

The suite exercises two isolated touch browser sessions, invitation link prefill, a mid-round refresh, two complete 54-card rounds, scoreboards and readiness for round three. It checks 320px and 390px phone layouts and that the hand fits on a 1024×768 tablet. Screenshots and a report are written to `artifacts/`. Engine tests independently exercise 250 randomized full rounds, private state projections, legal moves, scoring and readiness. Server integration tests verify reconnects, reserved seats, rejection of a third player, and persistence across restarts.

The responsive smoke suite rotates the same live game through ten phone/tablet viewport sizes, from 320×568 portrait and 568×320 landscape to 1180×820. It checks bidding, preparation, manual pickup, actual card play, suit shortcuts and dialogs: no horizontal page overflow, the hand within the viewport, 44px utility controls, unchanged card proportions, and no overlapping/out-of-table phase controls. It also checks invitation-first joining, inline name validation, accessible icon names, touch-accessible announcement help, the non-mutating pickup reminder, polite turn status, contextualized play requests, and reflow under a simulated 150% text increase. Enlarged text may require vertical scrolling. Reports and screenshots go to `artifacts/responsive/`; use `ARTIFACTS_DIR` for another directory or `BASELINE=1` to record layout violations without failing on them. These are Chromium touch-viewport checks, not a claim of testing on physical iOS/Android devices or with native screen readers.

Rare announcement eligibility can also be checked against a separate deterministic, local-only fixture server:

```sh
npm run build
node scripts/serve-browser-fixtures.mjs
```

In another terminal, with the production game still on port 3000:

```sh
FIXTURE_BASE_URL=http://127.0.0.1:3001 npm run test:browser
```

The fixture has its own disposable temporary rooms, binds only to loopback, and adds no test or seed API to production. Its fixed valid deck exercises all four kings, trula, and nine optional pickups that unlock valat while leaving three face-up cards on piles. It also plays the fixture round to check the failed-valat score, bonus replacement and result heading. Stop the fixture server when finished; its temporary rooms are removed on normal shutdown.

## Structure

- `src/`: React interface, responsive styles and the full-deck card reference.
- `shared/cards.mjs`: canonical card identities, Slovenian names and scan paths.
- `shared/game.mjs`: authoritative rules engine and private player projections.
- `server/index.mjs`: Express and Socket.IO server with atomic disk persistence.
- `tests/`: rules and multiplayer integration tests.
- `scripts/verify-browser.mjs`: complete browser gameplay verification.
- `scripts/verify-responsive.mjs`: phone/tablet orientation and touch-layout verification.

The persistence model supports one server instance and modest private groups. It does not require a database or an external service.

The entire game uses all 54 scanned faces from one Slovenian tarok deck; see [card sources, mapping and attribution](docs/cards.md). Open **Karte** in the header to inspect every card and its full Slovenian name. Fonts are self-hosted; see [font sources and licenses](docs/fonts.md).
