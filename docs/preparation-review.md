# Preparation and pickup review — 2026-09-06

The previous recorded verification comprised 78 automated tests, two complete Chromium rounds in separate browser contexts, and responsive checks. It missed the reported sequence: after one player confirmed, the browser immediately confirmed the other without trying that player's pickup. Center clicks and rectangle checks also missed partial obstruction of action buttons.

## Combined critic findings and changes

- **Confirmed UI obstruction:** rebuilding the original HEAD separately showed the own-pile region covering the lower part of readiness/reminder controls on tablet and desktop. At 1024×768, readiness occupied y278–322 while the pile region began at y305. Some inner-corner taps hit the pile container or label. Button centers remained usable; a complete engine deadlock was not reproduced. The table now gives piles and phase controls separate grid regions in normal document flow.
- **Disconnected pickup controls:** exposed pile faces supported playing and were disabled during preparation; the actual pickup buttons were below the entire hand. Each eligible pile now has its own 44px “Vzemi v roko” button directly beneath the card. Pickup remains separate from play and takes exactly one card. A status message identifies the card added to the hand.
- **Unclear preparation state:** the panel now leads with “Priprava,” explains who has confirmed and what the other player can still do, and explains when no pickups are available. Unavailable announcements do not occupy the main panel when none can be made; the information button retains their requirements. Confirmation still locks only that player's preparation, as required by the agreed rules.
- **Coverage:** new server and disposable-browser regressions exercise both readiness orders, pickup after the opponent confirms, separate newly exposed honors, restart/refresh, empty pickups, and starting actual play. Browser actions verify the center and four inner corners of controls before real clicks/taps.
- **Same-browser seats:** a second tab in the same browser profile resumes the same player. This behavior is now explicitly tested and documented; it must not silently allocate the opponent's seat.

## Verification

- `npm test`: 81 passed, including both server restart regressions.
- `npm run build`: passed.
- `npm run test:preparation`: 10 scenarios across desktop, phone, small phone, landscape phone, and tablet; both confirmation orders.
- `npm run test:responsive`: 66 checkpoints, no layout violations, four actual plays, touch targets, help/focus, and simulated 150% text sizing.
- `npm run test:browser`: two complete 54-card rounds, optional on/off-turn pickups, refresh, scoreboards, and readiness for round three.
- `npm run test:score-history`: eight scoring cases, four sizes, keyboard interaction, refresh, and unchanged saved state.

Browser tests use Chromium with touch emulation where applicable, not physical mobile devices. All gameplay verification used disposable room data. Reports and screenshots are in `artifacts/preparation/`, `artifacts/preparation-review-ui/`, `artifacts/preparation-review-gameplay/`, and `artifacts/score-history/` (Git-ignored).

Deployment completed on 2026-09-06 after passwordless sudo became available: `sudo -n docker compose up -d --build`. The existing named data volume was retained. The container is healthy, `/health` and `/ready` return HTTP 200 with zero room-restoration failures, and the deployed JavaScript/CSS asset names match the tested local build. Refresh both browsers to load the update.


## Starter-first confirmation and vertical piles — follow-up

The user requested that the player starting the first trick confirm first, and that the piles follow the physical table: opponent at the top, own piles at the bottom beside the hand. These decisions supersede the earlier either-player-first confirmation and side-by-side pile layouts.

- The server now projects `preparationTurn` and rejects a dealer's premature confirmation without changing state. Once the starter confirms, the dealer's confirmation unlocks. Optional pickups and eligible announcements remain available until each player's own confirmation.
- Already-saved confirmations are preserved. A round saved with the dealer already ready can still finish preparation without resetting cards or announcements.
- Every viewport uses the same vertical order: opponent piles, preparation/trick, own piles, hand. Small windows scroll vertically. Readiness and pickup targets remain at least 44px; normal flow keeps them separate.
- Validation: 86 automated tests; 12 focused browser cases across six viewports including 630×680 tiled desktop windows, with both starter seats and 120 table-order measurements; 66 responsive checkpoints with zero violations; two complete browser rounds; saved-score browser checks.
- Reports: `artifacts/preparation/report.json`, `artifacts/ordered-preparation-ui/report.json`, and `artifacts/ordered-preparation-gameplay/browser-verification.json`.


## Clear preparation and own won tricks — follow-up

Removed “Preveri prevzeme,” which only scrolled to pickup buttons and was redundant with the new pile placement. Preparation now says “Igra se začne, ko potrdita oba.” Actual one-card pickup buttons remain beneath eligible piles.

The clickable “TVOJI ŠTIHI” count at the bottom right of the table opens all of the viewer's won pairs for the current round, in winning order. It remains available at round end. The private `wonTricks` projection is derived from the existing saved `captured` pairs, so already-saved rounds work without a migration or a new history log. An unfinished trick is excluded. Viewing does not change cards, scores, or readiness; both players starting a new round clears that round's history.

Validation: 87 automated tests; 77 responsive checkpoints with no violations; the new `npm run test:trick-history` checks both players' private histories and all 27 pairs on three screen sizes, image loading, read-only cards, keyboard/focus, refresh, unchanged saved files, reset only after both request a new round, and updates after a real browser-played trick. Evidence is in `artifacts/trick-history/` and `artifacts/trick-history-ui/`.
