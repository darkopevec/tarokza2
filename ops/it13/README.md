# IT13 deployment

The current 2026-09-26 player-name release uses image
`tarokza2:player-name-20260926` and `compose.it13.yaml`. Settings now includes
the player name and an explicit Save name button. Changes are saved in the
identity registry and appear across linked devices and existing/future tables,
including opponent lists and score headings. Cards, scores, turns, room files
and revisions remain unchanged. All 12 languages include the new controls.

Back up the stopped volume before switching images and refresh browser tabs
afterward. Existing saves need no migration. Retain
`tarokza2:table-archive-20260926` for recovery; it can load the updated registry,
but existing table labels will use their saved pre-rename names. Keep the current
registry when rolling back code so renamed identities remain recoverable.

## Previous table archive release

The 2026-09-26 table archive release uses image
`tarokza2:table-archive-20260926` and `compose.it13.yaml`. Players can abandon a
table from home, then independently archive or delete their own list entry.
Pending choices survive offline sessions; archived entries appear at the bottom
of My tables and can be deleted later. During play, the settings gear contains
the language selector. Home and waiting screens retain the flag selector.

Existing games load without migration. New abandonments persist a closure marker
and private archive/delete choices; saved games remain retained. Back up the
stopped volume before switching images and refresh browser tabs afterward.
Keep `tarokza2:lobby-flags-20260926` for recovery, but it ignores these new markers
and can expose abandoned/deleted entries again. After players use the new actions,
prefer a compatible corrective release; review subsequent activity before any
rollback or restoration of older data. See [the protocol](../../docs/passwordless.md).

## Previous lobby and flag-selector release

The 2026-09-26 lobby and flag-selector release uses image
`tarokza2:lobby-flags-20260926` and `compose.it13.yaml`. It makes the table list
more compact, moves new-table creation beside the heading, and makes each table
row tappable with a status icon. The header uses local flag images for the native
language selector and keeps the tarokza2 wordmark visible on portrait phones.
Full language names remain in the menu, with 44px header controls at 320px.
Saved games and identities require no migration. Back up the stopped game volume
before switching images; retain `tarokza2:waiting-page-20260925` for code rollback
with the same saved data. Refresh browser tabs after deployment.

## Previous waiting-page release

The 2026-09-25 waiting-page release uses image
`tarokza2:waiting-page-20260925` and `compose.it13.yaml`. It separates the table
code and invitation actions, adds native sharing where available, keeps copying
and an optional QR code, and shows the two player seats. The mobile header fits
all controls with 44px targets. New copy is translated into all 12 languages.
Reloading preserves existing invitations; replacing one remains an explicit
action. Saved games and identities require no migration. Back up the stopped
game volume before switching images; retain `tarokza2:smrekar-restored-20260925`
for code rollback with the same saved data. Refresh browser tabs after deployment.

## Previous Smrekar artwork correction

The 2026-09-25 Smrekar artwork correction uses image
`tarokza2:smrekar-restored-20260925` and `compose.it13.yaml`. It corrects
white balance, tonal curves and perspective, preserves the scanned linework,
and gives all Smrekar platlci uniform white backgrounds. Faces and back use
versioned URLs so browsers refresh the artwork. Modiano remains the default.
Saved games and identities require no migration. Back up the stopped game
volume before switching images; retain `tarokza2:smrekar-deck-20260925` for
code rollback with the same saved data. Refresh browser tabs after deployment.
See [card decks](../../docs/cards.md).

## Previous Smrekar deck release

The 2026-09-25 Smrekar release uses image
`tarokza2:smrekar-deck-20260925` and `compose.it13.yaml`. It adds the optional
Smrekarjev tarok · Hinko Smrekar deck under Cards; Modiano remains the default.
The deck has 41 original faces, 13 reconstructed pip cards and its original back.
Deck preferences belong to each browser. Saved games and identities require
no migration. Back up the stopped game volume before switching images; retain
`tarokza2:slovenian-deck-20260925` for code rollback with the same saved data.
Refresh browser tabs to load the new option. See [card decks](../../docs/cards.md).

## Previous Slovenian deck release

The 2026-09-25 Slovenian card-deck release uses image
`tarokza2:slovenian-deck-20260925` and `compose.it13.yaml`. It adds the optional
Slovenski tarok · Piatnik deck under Cards; Modiano remains the default. The
54 faces include 38 original gallery images and 16 reconstructed pip cards.
Deck preferences belong to each browser. Saved games and identities require
no migration. Back up the stopped game volume before switching images; retain
`tarokza2:multilingual-20260925` for code rollback with the same saved data.
Refresh browser tabs to load the selector. See [card decks](../../docs/cards.md).

## Previous multilingual release

The 2026-09-25 multilingual release uses image `tarokza2:multilingual-20260925`
and `compose.it13.yaml`. It adds 12 interface languages, saved language choices
and IP country defaults using a bundled local database. Existing game and identity
files are unchanged. Back up the stopped game volume before switching images;
the previous `tarokza2:trick-lift-20260925` image remains suitable for code rollback
with the same saved data. Refresh browser tabs to load the language selector.
The image is also tagged with its Git revision and carries that revision in its
`org.opencontainers.image.revision` label. See [languages](../../docs/languages.md).

## Previous releases and hosting setup

The 2026-09-24 passwordless release uses image `tarokza2:passwordless-20260924`
and `compose.it13.yaml`. It adds player identities, device/recovery links, private
game invitations and migration of existing browser-held seat tokens. Refresh
existing browser tabs after upgrading. Back up the stopped game volume before
switching images. After identity migration or new version-2 games, code-only
rollback is insufficient: use the matching pre-release data backup and review
any subsequent games before restoring it. See [passwordless protocol](../../docs/passwordless.md).

The following records the earlier deployment setup and retained image tags.

Source: `https://github.com/darkopevec/tarokza2`. The September 17 deployment was built from baseline revision
`b252b9214ed99a396c714d3264d24f85bbe7f163`.

Release files live at `/home/pi-node/tarokza2` in IT13's Ubuntu WSL distro.
Docker Desktop runs image `tarokza2:security-20260917` (the base revision above plus the security hardening changes) as container `tarokza2`.
Production uses `compose.it13.yaml`, a copy of this directory's `compose.yaml`.
The repository's default Compose file is for local development; use the explicit
production file on IT13.

```sh
cd /home/pi-node/tarokza2
docker_cli='/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe'
"$docker_cli" compose -f compose.it13.yaml ps
"$docker_cli" compose -f compose.it13.yaml logs --tail 50
curl --fail http://127.0.0.1:3300/ready
```

The backend is published only on `127.0.0.1:3300`. Existing Ubuntu Nginx
proxies HTTP/WebSocket traffic, redirects HTTP to HTTPS, preserves both domains,
and replaces client-provided forwarding headers. Docker's bridge is pinned to
`172.20.0.0/16`; the app trusts only the observed proxy peer `172.20.0.1`.
Nginx config: `/etc/nginx/sites-available/tarok`, enabled through `sites-enabled`.

Both `tarok.moonlitgarden.cc` and `tarok.moonlitgarden.xyz` have Spaceship A
records to `89.212.220.103`, TTL 300. The certificate is named `tarok`, stored in
`/etc/letsencrypt/live/tarok`, and renewed by the existing Certbot timer using
`/usr/local/libexec/spaceship-dns01 auth|cleanup`. Credentials remain in the
existing root-only credentials file. The renewal deploy hook reloads Nginx.

Game saves persist in Docker volume `tarokza2_tarok-data`, mounted at `/app/data`.
Retain it during updates and restarts; do not use `down --volumes`. Each domain
has separate browser storage, so players should retain their original invitation
hostname to reclaim their seats.

For an update, copy a reviewed source revision into the release directory, build
an image with its revision tag, update `image` in `compose.it13.yaml`, then run:

```sh
"$docker_cli" build -t tarokza2:REVISION .
"$docker_cli" compose -f compose.it13.yaml up -d
curl --fail http://127.0.0.1:3300/health
curl --fail http://127.0.0.1:3300/ready
```

Back up the game volume with the app stopped before a version change. Restore the
previous image tag and run `up -d` to roll back code while retaining the volume.
Do not restore old game data over newer games without reviewing the consequences.

Validation: production image built successfully; all automated tests passed
in a disposable container with source/tests copied in, isolated from game saves.
Run `python3 ops/it13/verify.py` from the repository root on another machine to check both public sites, asset
loading, readiness, Socket.IO polling and WebSocket upgrades without creating games.
Docker restart policy is `unless-stopped`; availability also depends on the host's
existing Docker Desktop, WSL, Nginx and inbound forwarding starting normally.

Security controls and defaults are documented in `docs/deployment.md`. The previous image `tarokza2:b252b92` is retained for rollback.

Security deployment verified on 2026-09-17: 97 automated tests passed; the
container restrictions also passed the 94-test suite before the final three
admission regression cases were added. Two complete browser rounds passed with
CSP enabled, including mid-round reconnect and score persistence. Both public
hosts passed HTTPS, security-header, readiness, polling, WebSocket and Chromium
rendering checks. Root filesystem writes fail with EROFS; the game volume remains
writable. No production games were created by verification.

Pre-deployment backup on IT13: `/home/pi-node/tarok-security-backup.6MYlkz`
(previous Compose/Nginx files and `games.tar.gz`). Nginx also retains its previous
configuration at `/var/backups/tarok-nginx.Iw6T4m`.
