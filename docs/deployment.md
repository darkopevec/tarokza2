# Running TarokZa2

TarokZa2 runs as one Docker container with a persistent volume for tables and games. The same process serves the built website and its Socket.IO multiplayer connection. The IT13 deployment serves `tarok.moonlitgarden.cc` and `tarok.moonlitgarden.xyz`; its production configuration and runbook are in `ops/it13/`.

From the repository directory, run:

```sh
docker compose up --build -d
docker compose ps
```

Open <http://localhost:3000>. For two devices on the same network, open `http://YOUR_COMPUTER_LAN_IP:3000` on both devices. Create a table and share its private invitation link or QR code. Generate the invitation from the LAN address so the other device receives a reachable link.

The container runs as the unprivileged `node` user, restarts unless explicitly stopped, and checks `/health` every 30 seconds. Check its status with:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/ready
docker compose logs --tail=50 tarokza2
```

`/health` is process liveness and returns `200 {"ok":true}` while the server is accepting requests. Docker continues checking this endpoint, not `/ready`.

`/ready` reports saved-room restoration at startup. A clean start returns `200 {"ok":true,"restoration":{"status":"ok","failedRooms":0}}`. If a room could not be restored, it returns HTTP 503 with `ok:false`, `status:"degraded"`, and the failed-room count; `/health` remains 200 and other restored games remain usable. Neither endpoint exposes room codes, filenames, player names, tokens, or cards, and both disable caching. Alert an operator on degraded restoration; do not use it to trigger automatic restart loops or unnecessarily cut off working games. This is not a continuous disk-writability check.

## Port and public hosting

The default host port is 3000. To change it, copy `.env.example` to `.env`, set `PORT`, and restart the Compose service. The container continues listening on port 3000 internally.

For public hosting, put this service behind an HTTPS reverse proxy. Preserve the original `Host` header and forward WebSocket upgrades for `/socket.io`. The application accepts Socket.IO browser requests from its own origin. Run one application instance against its volume; this release uses local room files rather than a shared database or a distributed Socket.IO adapter.

## New-table limits and trusted proxies

By default, one client IP can attempt to create **60 new tables per hour**. Room-creation attempts, including unauthenticated requests or failed saves, consume the quota before room disk work. Identity creation has its own authentication request limit. It is shared across tabs and socket reconnects; changing the browser session does not reset it. IPv4 and IPv4-mapped IPv6 share an identity, and native IPv6 addresses in one `/64` share a quota. Joining, resuming, leaving, and game actions do not consume this quota; the existing per-connection burst guard still applies to all requests. A rejected creation receives a Slovenian wait message, `code:"ROOM_CREATE_LIMIT"`, and `retryAfterMs`.

Set `ROOM_CREATE_LIMIT` and `ROOM_CREATE_WINDOW_MS` in the Compose `.env` to tune this for shared networks. Both must be positive safe integers; invalid configuration stops startup rather than silently disabling protection. Direct Node runs require these variables to be exported in the environment; Node does not load `.env` automatically. The quota is an in-memory fixed window starting with the first attempt, resets on process restart, and is not shared across application instances. At most 10,000 active client buckets are retained; when full, unseen clients cannot create a table until a bucket expires. Tracked clients keep their existing quota. No client IPs are written to saved games or application logs by this feature.

`TRUSTED_PROXIES` defaults to empty: only the actual network peer determines the quota, and client-supplied forwarding headers are ignored. Behind a proxy, set it to a comma-separated list of that proxy's **exact source IP addresses or narrowly scoped CIDRs as seen by this application**. The server walks `X-Forwarded-For` from the nearest hop to the first untrusted address. It does not accept blanket trust or hop-count settings. Use plain IPv4 CIDRs for IPv4-mapped peers; mapped IPv6 CIDRs are rejected because their prefix conversion can accidentally trust every IPv4 address. An invalid forwarded address falls back to the peer's shared quota.

The proxy must sanitize incoming `X-Forwarded-For`, preserve `Host`, and forward WebSocket upgrades. Restrict the backend port to the intended proxy when publicly hosting, and do not trust broad client/LAN ranges. Otherwise clients may forge identities or all users may share the proxy's quota. Docker source addresses depend on the deployment network; do not assume a host-loopback proxy appears as `127.0.0.1` inside the container. The trust-chain behavior follows the [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/) and is applied to [Socket.IO's initial HTTP request](https://socket.io/docs/v4/server-socket-instance/#socketrequest), including WebSocket connections.

These are application-level safeguards, not DDoS protection. Add connection/request limits at the public proxy and monitor disk usage. This change adds **no saved-room expiry, deletion, or total room cap**. Such retention policies need a separate decision so active and recoverable games are preserved.

## Saved games and reconnecting

The Compose volume `tarok-data` is mounted at `/app/data`. Each accepted action is written to a replacement room file and then atomically renamed. Private cards, round results, readiness, and both reserved player seats survive application restarts. Private credentials are never written to disk; the server stores their SHA-256 hashes. The versioned `identities.json` registry stores players, independent browser credentials, pending device links, recovery hashes, and migrated seat ownership; include it in every backup alongside room files.

The browser retains one private device credential for a global player. The server derives “My tables” from room ownership and migrated legacy seats. Returning home detaches the tab but preserves membership. A long invitation secret admits one opponent; the six-character room ID cannot grant access. Device links expire after 15 minutes and are consumed once; recovery links remain valid until replaced. Secrets appear in URL fragments, are captured and removed from the address bar, and are never included in public game state. The QR code is generated locally.

Existing version-1 room files stay readable. The browser proves ownership with its saved per-room tokens and removes each only after an acknowledged claim. Conflicting seats require selection; names never determine ownership. New room files use version 2 and reference global user IDs while retaining game-local seat IDs. Back up the data volume before deployment; rolling back requires restoring the matching pre-migration backup, because older servers cannot read version-2 rooms or identity ownership.

A corrupt identity registry fails closed, remains untouched, and makes `/ready` return 503 with `identityRegistry: "degraded"`; `/health` remains available. Restore the registry and rooms from a consistent backup, then restart. Registry writes are serialized and atomically replaced; a failed write does not publish an identity change. These file-backed stores support one application process only.

Stop the application while retaining saved tables with:

```sh
docker compose down
```

The named volume also survives rebuilds and `docker compose up`. Removing the volume, including with `docker compose down --volumes`, deletes the saved games. Back up that volume when moving the application to another host.

### Recovering a damaged save

When startup cannot load a recognized room file, it leaves the original bytes in place, reserves that room code against reuse, and logs the filename without private contents. Healthy room files still restore normally. To recover, stop the application, back up the volume, inspect the affected file locally, and restore a known-good copy or carefully repair it. Restart and check `/ready` again. The degraded count is a startup snapshot; editing files under a running process does not reload them. Do not delete damaged saves or recreate the volume merely to clear the alert.

## Development without Docker

Node.js 22 or newer is required.

```sh
npm ci
npm run server
```

In a second terminal, run `npm run dev` and open the Vite address it prints. Vite forwards `/socket.io`, `/api`, `/health`, and `/ready` to the multiplayer server on port 3000. The `/api/locale` endpoint supplies the IP-based language default described in [Languages](languages.md). Direct Node runs save tables in `./data`; set `DATA_DIR` to use another directory.

For a production build without Docker:

```sh
npm run build
npm start
```

Run engine and multiplayer integration checks with `npm test`. After starting the production application, `npm run test:browser` plays two complete rounds through separate mobile and tablet browser sessions and writes screenshots plus a verification report under `artifacts/`.

## Shared abuse controls and container restrictions

In addition to the independent new-table quota, the server limits each verified
client IP (IPv6 /64) to 600 Socket.IO events per 10 seconds, 60 authentication/account/room-management
requests per minute, and 60 new Engine.IO handshakes per minute. Unknown events
also count toward the event quota. Counters survive reconnects and transport
changes and reset at server restart. Each limiter retains at most 10,000 active
identities; new identities fail closed when that capacity is full.

There may be at most 20 Engine.IO connections per client IP and 1,000 overall,
including connections without a Socket.IO session. Slots are reserved before
handshake approval, released on disconnect, and abandoned handshakes expire after
10 seconds. A polling-to-WebSocket upgrade retains its existing slot. The
existing per-socket burst limit and 16 KiB message limit also remain in place.
Shared-IP networks share these quotas. Join/resume throttling does not itself
consume or block the separate gameplay event allowance. Exceeded event quotas
return `REQUEST_RATE_LIMIT` or `AUTH_RATE_LIMIT` with `retryAfterMs`; handshake
rejections use Engine.IO's generic forbidden response. The factory's `abuseLimits`
option can override defaults for tests or custom embeddings; all values must be
positive safe integers.

Both Compose files use a non-root user, read-only root filesystem, dropped Linux
capabilities, and `no-new-privileges`. Only the game volume and a 16 MiB temporary
filesystem are writable. Limits are 512 MiB RAM, one CPU, and 100 processes;
Docker logs rotate at 10 MiB with three files retained. These limits should be
reviewed against real usage before growing beyond modest private groups.

IT13 Nginx limits HTTP requests to 20/second/IP with a burst of 100 and 30 active
connections/IP. The burst accommodates card images and multiple players behind
one router. WebSocket messages are limited inside the app, since Nginx HTTP rate
limits do not inspect upgraded traffic. Request bodies are capped at 32 KiB.

The HTTPS sites send a CSP allowing self-hosted scripts/styles/fonts, deck images
and the bundled data-URL texture, and same-origin multiplayer connections. The
policy denies framing, plugins, and base-URL changes. HSTS applies for one year
to each Tarok hostname; it does not enable preload or include unrelated subdomains.
`X-Frame-Options: DENY`, Permissions-Policy and one consistent Referrer-Policy are
also set. Use `node scripts/verify-security-browser.mjs` after `npm run build` to
exercise two-player gameplay with this CSP against disposable local saves.
