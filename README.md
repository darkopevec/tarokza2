<div align="center">

# 👑 TarokZa2

### Share a link. Settle in. Play.

**Slovenian tarok for you and a friend.**

📱 Phone & tablet first · 🤝 Private multiplayer · 🔓 No account required

**♠️ ♥️ ♦️ ♣️**

[🚀 Get started](#get-started) · [🎮 How to play](#play) · [📜 Rules](#rules) · [🛠️ Development](#development) · [🧪 Verification](#verification)

</div>

---

Create a private table, send its private invitation link or QR code, and play Slovenian tarok together in separate browsers. Bring a friend — the table is yours. 🥂

| ✨ At the table | 🎁 What you get |
| :--- | :--- |
| 🤝 Just the two of you | Private tables with invitation links and QR codes. |
| 👑 A full Slovenian deck | All 54 scanned card faces, with translated names and an in-game gallery. |
| 🌍 Choose your language | 12 languages, IP country defaults, browser fallback and a saved language selector on every screen. |
| 📱 Made for touch | Responsive phone and tablet layouts, swipeable hands and suit shortcuts. |
| 🔄 Pick up where you left off | Reclaim your seat in the same browser after a refresh or reconnect. |
| 🏆 Every round counts | Persistent scoreboards, saved score explanations and your won-trick history. |
| 🏡 Host your own table | Docker deployment with disk persistence; no database or external service required. |

> 🧭 **Continuing development?** Start with the short [agent handoff](HANDOFF.md).

The interface supports Slovenian, English, Spanish, German, French, Italian, Czech, Slovak, Hungarian, Danish, Romanian and Polish. Each player chooses independently; changing language keeps the same table, cards and scores. The game always uses the existing Slovenian two-player rules. See [language coverage and translation maintenance](docs/languages.md).

---

<a id="get-started"></a>

## 🚀 Get started with Docker

```sh
docker compose up -d --build
```

🌐 Open **[localhost:3000](http://localhost:3000)**. On another device on your network, open `http://YOUR_COMPUTER_IP:3000`. Create invitations from that address so the other device can follow the link. Internet play requires a reachable host; use an HTTPS reverse proxy that supports WebSocket connections.

### 🔧 Keep your table running

```sh
docker compose ps
docker compose logs -f
curl http://localhost:3000/health
docker compose down
```

💾 The container runs as a non-root user. The `tarok-data` volume retains games, seat credentials and scoreboards across restarts. `docker compose down` keeps this volume; removing volumes also removes the saved games. On systems where Docker requires elevated access, prefix Docker commands with `sudo`.

See [deployment details](docs/deployment.md) for port configuration, reverse proxies and backups.

### 🌍 Hosting for friends online

Public-hosting safeguards include a reconnect-resistant new-table quota (default: 60 attempts per IP per hour), explicit trusted-proxy configuration, and a separate `/ready` restoration check. Existing games are not expired or deleted. `/health` remains the Docker liveness check; degraded restoration alerts an operator while healthy games stay usable. See [limits and recovery](docs/deployment.md#new-table-limits-and-trusted-proxies) before exposing the service publicly.

<a id="play"></a>

## 🎮 Pull up a chair

1. 🪑 **Create a table.** Enter your name and select **Ustvari mizo**.
2. 💌 **Invite a friend.** Copy the private invitation link or scan its QR code and share it with your opponent.
3. 🤝 **Take your seats.** Your opponent enters their name in the join form and selects **Pridruži se**. Invitation links show a join confirmation and ask newcomers only for a display name. Room codes are labels, not credentials. Each browser sees only its own hand and the public table.
4. 🗣️ **Place your bid.** Bid **Igram** or **Naprej**. The pile tops open and play begins; no cards move into the hand automatically.
5. 👑 **Play immediately.** The non-dealer leads as soon as bidding ends. Optionally take an exposed tarok or king using **Vzemi v roko** at the bottom of its pile card, even off turn. Each click takes one card. There are no bonus declarations or preparation confirmations.
6. 👑 **Play your hand.** Tap a highlighted card to play it on your turn. Swipe the hand horizontally or tap a suit shortcut to find its cards; the shortcuts only scroll your hand. Playing from a pile is distinct from the **Vzemi v roko** action: during play you may still take exposed taroks/kings later, even on the opponent's turn, without consuming a turn.
7. 🏆 **Count the spoils.** After 27 tricks, both players see the round result with a game/bonus/penalty breakdown and cumulative scoreboard. Select **Nova runda**; a new deal starts after both players are ready.

### 🏆 Revisit your tricks and scores

**TVOJI ŠTIHI**, the clickable count at the bottom right of the table, shows all the pairs you won in the current round, in the order you won them. It works during play and on the round result screen, including already-saved rounds. It is read-only; the list clears when both players start the next round.

Each historical round identifies who announced the game. Open **Izračun runde** to see that round's saved card points, base-game calculation, bonuses/penalties, and resulting score for each player. This works both at the end of a round and in **Rezultati** during later rounds. Valat replacement and 35–35 ties are explained explicitly. Older rows retain their original scoring; unavailable or inconsistent details are marked instead of inventing a calculation. Opening an explanation never changes a score.

### 🔄 Come back to your seat

Your player owns all your tables, accessible from **Moje mize** on every linked browser. Refresh restores your current table; leaving returns home without losing your seat. No username, password, or email is required. In **Naprave in obnovitev**, generate a single-use, 15-minute link or QR code to add another browser, name devices, or remove a lost device. Each browser gets its own private credential; both can play the same seat. Save a separate private recovery link to restore access if all devices are lost. Generating a new recovery link invalidates the old one. Without that link or a connected browser, access cannot be restored. A browser belonging to another player cannot switch or merge identities; use a separate browser profile. Existing browser-held seat tokens migrate without resetting games. Old short invitations must be replaced by a new private invitation.

Use the trash icon beside a table in **Moje mize** to **Opusti mizo**. After confirmation, the table closes for both players. Each player independently chooses **Arhiviraj** or **Izbriši**; an offline player gets the choice when they return. Archived tables appear in **Arhiv** at the bottom of the home screen and can be deleted later. Deleting removes the table only from your own list, across your linked devices. The other player's archive is unchanged. Abandoned tables cannot be resumed, and existing invitations stop working. Returning home with **Zapusti mizo** still keeps your seat.

During play, open the **Nastavitve** gear in the header to change language or your player name. Enter a name of 1–24 characters and select **Shrani ime**. The saved name appears across your tables and linked devices, including for opponents, without changing your cards, turn, or scores. The home and waiting screens keep the flag selector.

<details>
<summary>🛡️ How the game handles plays from multiple tabs</summary>

Card plays carry the displayed round and trick position. If another tab has already advanced play, the server rejects the outdated request and sends the current table instead of letting that card start the next trick. Optional pickups do not invalidate this position; card legality is still checked against the latest table. After upgrading from an older client, refresh the page if a play asks you to do so. Existing saved rounds and scores do not require migration.

</details>

### 📱 A table that fits your screen

Phone layouts place the two labelled pile groups side by side; landscape phones put the table beside the hand. Tablet layouts use larger card faces. Main touch controls are at least 44px, card proportions remain 63:113, and safe-area padding accounts for screen notches. The hand remains horizontally scrollable; optional pickup/history details can also be reached by scrolling the page vertically on the smallest screens.

<a id="rules"></a>

## 📜 Know your cards

Uses the Slovenian two-player Napoleon deal and play, with the explicit difference-based scoring in **Tarok.net, chapters 2.1–2.2**. Taking exposed kings and taroks into the hand is **optional**, at any time during play, as confirmed by the user. These choices and the 35–35 edge case are explained in [the rules](docs/rules.md) and the in-game **Kako igrati** dialog.

### ✨ Bonuses, calls and the mighty valat

The two-player additions are kings/trula **+10** each, valat **+250**, and **−21 mondfang** for losing Mond to Škis. Valat replaces the base game and set bonuses; mondfang stays separate. Bonuses are scored from captured cards without declarations. Existing saved declarations retain their original scoring, and earlier score rows are not rewritten. Saved preparation screens resume directly into play.

### 👑 The deal

Each player receives **15 hand cards plus three stacks of four**. The server enforces bidding, following suit, mandatory trumping, stack restrictions, and the 27-trick round. Score history persists between rounds. Kings and taroks explicitly taken into the hand are recorded for both players to inspect.

<a id="development"></a>

## 🛠️ Local development

📦 **Node.js 22 or newer is required.** With mise, select a current Node version before installing dependencies.

```sh
npm ci
npm run server
```

🎨 In another terminal, start the frontend:

```sh
npm run dev
```

Vite serves the frontend on port 5173 and proxies multiplayer requests to port 3000. For a production run without Docker:

### 📦 Build & serve

```sh
npm run build
npm start
```

<a id="verification"></a>

## 🧪 Verification

> 🧰 **Before browser checks:** run `npm run build`. The general browser and responsive suites need a running disposable app; preparation, score-history and trick-history checks start their own servers.

```sh
npm test
npm run test:browser
npm run test:responsive
npm run test:preparation
npm run test:card-loading
npm run test:score-history
npm run test:trick-history
```

<details>
<summary>🎭 Full browser gameplay & engine coverage</summary>

The general browser verification requires a running app. Use a disposable server with a temporary data directory and set `BASE_URL`; the default port 3000 may be your live app, so do not run tests against it. It uses system Chromium when available; otherwise install Playwright Chromium with `npx playwright install chromium`. Set `BASE_URL` to use a different deployment, or `CHROMIUM_EXECUTABLE_PATH` for a different Chromium executable.

To watch the verification and leave both player windows open, ready for round three:

```sh
HEADLESS=0 KEEP_BROWSER_OPEN=1 npm run test:browser
```

The suite exercises two isolated touch browser sessions, private invitation joining, a mid-round refresh, two complete 54-card rounds, scoreboards and readiness for round three. It checks 320px and 390px phone layouts and a 1024×768 tablet. Screenshots and a report are written to `artifacts/`. Engine tests independently exercise 250 randomized full rounds, private state projections, legal moves, scoring and readiness. Server integration tests verify reconnects, reserved seats, rejection of a third player, and persistence across restarts.

</details>

<details>
<summary>📱 Responsive layouts & accessibility checks</summary>

The responsive smoke suite checks bidding, immediate play, manual pickups, suit shortcuts and dialogs across phone and tablet sizes. Reports and screenshots go to `artifacts/responsive/`. These are Chromium viewport checks, not physical-device tests.

</details>

<details>
<summary>👑 Preparation & optional-pickup regression</summary>

The preparation regression now verifies immediate play after bidding, absence of declaration and confirmation controls, optional off-turn pickups, refresh, same-browser seat resumption, and the first trick. It starts a disposable server with a deterministic deck. Run `npm run build` first; evidence goes to `artifacts/preparation/`.

</details>

<details>
<summary>🧮 Saved score calculations</summary>

The score-history check starts its own disposable loopback server and deterministic presentation fixtures; no running production game is needed. It checks old-round bidder/calculation accuracy, ties, bonuses, valat, legacy rows, keyboard disclosure controls, phone/tablet layouts, and unchanged stored state after expansion and refresh. Screenshots and its report go to `artifacts/score-history/`. Run `npm run build` first so it tests the current frontend.

</details>

<details>
<summary>🔮 Deterministic pickup fixtures</summary>

Bonus controls remain absent even with complete sets in hand; optional pickups can be checked against a separate deterministic, local-only fixture server:

```sh
npm run build
node scripts/serve-browser-fixtures.mjs
```

In another terminal, with a disposable test game on port 3000:

```sh
FIXTURE_BASE_URL=http://127.0.0.1:3001 npm run test:browser
```

The fixture has its own disposable temporary rooms, binds only to loopback, and adds no test or seed API to production. Its fixed valid deck includes all four kings and trula, verifies that declaration controls are absent, and exercises nine optional pickups while leaving three face-up cards on piles. Stop the fixture server when finished; its temporary rooms are removed on normal shutdown.

</details>

<details>
<summary>🏆 Won-trick history & round reset</summary>

`npm run test:trick-history` uses its own disposable server and a legally completed round to check both private histories, all 27 pairs, phone/tiled/tablet dialogs, refresh, unchanged saved state, next-round reset, and live additions after an actual browser-played trick. Run `npm run build` first; evidence goes to `artifacts/trick-history/`.

</details>

---

<a id="structure"></a>

## 🗂️ Under the hood

| 📂 Path | 🧩 Purpose |
| :--- | :--- |
| [`src/`](src/) | 🎨 React interface, responsive styles and the full-deck card reference. |
| [`shared/cards.mjs`](shared/cards.mjs) | 👑 Canonical card identities, Slovenian names and scan paths. |
| [`shared/game.mjs`](shared/game.mjs) | ⚖️ Authoritative rules engine and private player projections. |
| [`server/index.mjs`](server/index.mjs) | 🔌 Express and Socket.IO server with atomic disk persistence. |
| [`tests/`](tests/) | 🧪 Rules and multiplayer integration tests. |
| [`scripts/verify-browser.mjs`](scripts/verify-browser.mjs) | 🎭 Complete browser gameplay verification. |
| [`scripts/verify-responsive.mjs`](scripts/verify-responsive.mjs) | 📱 Phone/tablet orientation and touch-layout verification. |

The persistence model supports one server instance and modest private groups. It does not require a database or an external service.

## 💛 Cards, fonts & credits

The entire game uses all 54 scanned faces from one Slovenian tarok deck; see [card sources, mapping and attribution](docs/cards.md). Open **Karte** in the header to inspect every card and its full Slovenian name. Fonts are self-hosted; see [font sources and licenses](docs/fonts.md).

---

<div align="center">

**👑 Shuffle up. Invite a friend. Naj zmaga najboljši! 🏆**

[🚀 Start a table](#get-started) · [📖 Full rules](docs/rules.md) · [🏡 Deployment guide](docs/deployment.md) · [🧭 Agent handoff](HANDOFF.md)

</div>

Run `npm run test:identity` for isolated browser checks of invitations, QR codes, linked devices, recovery, conflicts, and revocation. It creates and removes its own temporary data directory.

Run `npm run test:name-change` after building to check the Settings name editor, validation, linked-device and opponent updates, persistence, and unchanged gameplay using disposable tables.

Run `npm run test:table-management` after building to verify abandonment, independent archive/delete choices, later archive deletion, linked-device updates, offline choices, and phone layouts using disposable tables.

Run `npm run test:waiting` after building to check mobile and desktop invitation sharing, copying, QR disclosure, reloads, replacement, and joining. It uses temporary local rooms and checks that sharing and reloading preserve the invitation.

The card-loading check starts a disposable server and verifies immediate table entry while image downloads are delayed, visible-card priority, background preloading, and persistent artwork access from a fresh tab with the network unavailable. Only public card images are stored in Cache Storage, without a time-based expiry. Versioned artwork URLs also use a one-year immutable HTTP cache; bump `CARD_ART_VERSION` when replacing artwork. Game state, identity credentials and application pages are never cached by the card service worker.
