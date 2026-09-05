# Running TarokZa2

TarokZa2 runs as one Docker container with a persistent volume for tables and games. The same process serves the built website and its Socket.IO multiplayer connection. No external hosting provider or public domain is configured.

From the repository directory, run:

```sh
docker compose up --build -d
docker compose ps
```

Open <http://localhost:3000>. For two devices on the same network, open `http://YOUR_COMPUTER_LAN_IP:3000` on both devices. Create a table and share its invitation link or six-character code. Generate the invitation from the LAN address so the other device receives a reachable link.

The container runs as the unprivileged `node` user, restarts unless explicitly stopped, and checks `/health` every 30 seconds. Check its status with:

```sh
curl http://localhost:3000/health
docker compose logs --tail=50 tarokza2
```

The health endpoint returns `{"ok":true}` when the server is accepting requests.

## Port and public hosting

The default host port is 3000. To change it, copy `.env.example` to `.env`, set `PORT`, and restart the Compose service. The container continues listening on port 3000 internally.

For public hosting, put this service behind an HTTPS reverse proxy. Preserve the original `Host` header and forward WebSocket upgrades for `/socket.io`. The application accepts Socket.IO browser requests from its own origin. Run one application instance against its volume; this release uses local room files rather than a shared database or a distributed Socket.IO adapter.

## Saved games and reconnecting

The Compose volume `tarok-data` is mounted at `/app/data`. Each accepted action is written to a replacement room file and then atomically renamed. Private cards, round results, readiness, and both reserved player seats survive application restarts. Raw reconnect tokens are never written to disk; the server stores their SHA-256 hashes.

The browser retains a private reconnect token for each table. Refreshing the page or reconnecting restores that player's seat. Leaving a table detaches the tab while retaining the seat and game; returning from the same browser can resume it. The invitation code admits the second player but does not grant access to an already occupied seat.

Stop the application while retaining saved tables with:

```sh
docker compose down
```

The named volume also survives rebuilds and `docker compose up`. Removing the volume, including with `docker compose down --volumes`, deletes the saved games. Back up that volume when moving the application to another host.

## Development without Docker

Node.js 22 or newer is required.

```sh
npm ci
npm run server
```

In a second terminal, run `npm run dev` and open the Vite address it prints. Vite forwards `/socket.io` and `/health` to the multiplayer server on port 3000. Direct Node runs save tables in `./data`; set `DATA_DIR` to use another directory.

For a production build without Docker:

```sh
npm run build
npm start
```

Run engine and multiplayer integration checks with `npm test`. After starting the production application, `npm run test:browser` plays two complete rounds through separate mobile and tablet browser sessions and writes screenshots plus a verification report under `artifacts/`.
