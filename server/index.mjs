import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import proxyaddr from 'proxy-addr';
import { Server } from 'socket.io';
import * as defaultEngine from '../shared/game.mjs';
import { createAbuseControls } from './abuse-controls.mjs';
import { canonicalClientAddress, createCreationLimiter } from './creation-limiter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

class RequestError extends Error {
  constructor(message, code, retryAfterMs) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));

function cleanName(value) {
  if (typeof value !== 'string') throw new RequestError('Vnesi svoje ime.');
  const name = value.trim().replace(/\s+/gu, ' ');
  if (!name || [...name].length > 24 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new RequestError('Ime naj vsebuje od 1 do 24 znakov.');
  }
  return name;
}

function cleanCode(value) {
  if (typeof value !== 'string') throw new RequestError('Vnesi veljavno kodo mize.');
  const code = value.trim().toUpperCase();
  if (!ROOM_CODE.test(code)) throw new RequestError('Koda mize mora imeti 6 znakov.');
  return code;
}

function createPlayer(name) {
  const token = randomBytes(32).toString('base64url');
  return { token, player: { id: randomUUID(), name, tokenHash: tokenHash(token) } };
}

function compileTrustedProxies(ranges) {
  if (!Array.isArray(ranges) || ranges.some(range => {
    if (typeof range !== 'string') return true;
    const [address, prefix, extra] = range.split('/');
    const version = isIP(address);
    // proxy-addr converts mapped /96 to IPv4 /0. Require plain IPv4 CIDR syntax
    // for mapped ranges so a superficially narrow IPv6 prefix cannot trust everyone.
    const mappedRange = prefix !== undefined && version === 6 && isIP(canonicalClientAddress(address)) === 4;
    return !version || mappedRange || extra !== undefined || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)));
  })) throw new TypeError('TRUSTED_PROXIES must contain explicit IP addresses or CIDRs; trusting every address is not allowed.');
  return proxyaddr.compile(ranges);
}

function matchesToken(player, token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return false;
  const expected = Buffer.from(player.tokenHash, 'hex');
  const actual = Buffer.from(tokenHash(token), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Create an independently testable server. No sockets or timers start until listen(). */
export async function createTarokServer({
  dataDir = process.env.DATA_DIR || path.resolve(HERE, '../data'),
  distDir = path.resolve(HERE, '../dist'),
  engine = defaultEngine,
  logger = console,
  creationLimit = {},
  abuseLimits = {},
  trustedProxies = (process.env.TRUSTED_PROXIES || '').split(',').map(value => value.trim()).filter(Boolean),
  now = Date.now,
} = {}) {
  const trustProxy = compileTrustedProxies(trustedProxies);
  const abuse = createAbuseControls(abuseLimits, now);
  const admitted = Symbol('tarokAdmission');
  const pendingAdmissions = new Set();
  function clientKey(request) {
    let key;
    try { key = canonicalClientAddress(proxyaddr(request, trustProxy)); } catch { /* Use actual peer. */ }
    return key || canonicalClientAddress(request.socket.remoteAddress) || 'unknown-peer';
  }
  const creationLimiter = createCreationLimiter({
    limit: creationLimit.max ?? Number(process.env.ROOM_CREATE_LIMIT ?? 60),
    windowMs: creationLimit.windowMs ?? Number(process.env.ROOM_CREATE_WINDOW_MS ?? 3_600_000),
    maxKeys: creationLimit.maxKeys ?? 10_000,
    now,
  });
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const rooms = new Map();
  const unrestoredRoomIds = new Set();
  const queues = new Map();
  const connections = new Map();
  let shuttingDown = false;

  for (const filename of await readdir(dataDir)) {
    if (!/^[A-HJ-NP-Z2-9]{6}\.json$/.test(filename)) continue;
    try {
      const room = JSON.parse(await readFile(path.join(dataDir, filename), 'utf8'));
      if (room.version !== 1 || room.id !== filename.slice(0, 6) ||
          !Array.isArray(room.players) || room.players.length < 1 || room.players.length > 2 ||
          room.players.some((player) => typeof player.id !== 'string' ||
            typeof player.name !== 'string' || !/^[a-f0-9]{64}$/.test(player.tokenHash))) {
        throw new Error('Invalid room record');
      }
      // Exercise sanitization before accepting a saved game, without logging its contents.
      if (room.game) room.players.forEach((player) => engine.viewFor(room.game, player.id));
      rooms.set(room.id, room);
    } catch {
      // Never reuse the code of a retained file: its contents may still be recoverable.
      unrestoredRoomIds.add(filename.slice(0, 6));
      logger.warn(`Could not load saved room ${filename}; file retained for recovery.`);
    }
  }

  async function persist(room) {
    const target = path.join(dataDir, `${room.id}.json`);
    const temporary = path.join(dataDir, `.${room.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(room), { mode: 0o600, flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  async function withRoom(roomId, operation) {
    const previous = queues.get(roomId) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(roomId, next);
    try {
      return await next;
    } finally {
      if (queues.get(roomId) === next) queues.delete(roomId);
    }
  }

  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.get('/health', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.status(shuttingDown ? 503 : 200).json({ ok: !shuttingDown });
  });
  app.get('/ready', (_request, response) => {
    const ok = !shuttingDown && unrestoredRoomIds.size === 0;
    response.setHeader('Cache-Control', 'no-store');
    response.status(ok ? 200 : 503).json({
      ok,
      restoration: { status: unrestoredRoomIds.size ? 'degraded' : 'ok', failedRooms: unrestoredRoomIds.size },
    });
  });
  app.use(express.static(distDir, { index: false }));
  app.get(/.*/, (request, response, next) => {
    if (!request.accepts('html')) return response.sendStatus(404);
    response.sendFile(path.join(distDir, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
  app.use((error, _request, response, _next) => {
    response.status(error.status === 404 ? 404 : 500).json({ error: 'Stran ni na voljo.' });
  });

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 16 * 1024,
    pingTimeout: 20_000,
    pingInterval: 25_000,
    // Invitations are public; reconnect tokens must only be sent from this application's origin.
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== request.headers.host) return callback(null, false);
        } catch { return callback(null, false); }
      }
      const key = clientKey(request);
      if (shuttingDown || !abuse.handshakes.consume(key).allowed) return callback(null, false);
      const release = abuse.acquire(key);
      if (!release) return callback(null, false);
      // Reserve before approval, including handshakes that never finish. Release
      // failed/aborted handshakes; successful Engine.IO sessions own the slot.
      const cleanup = () => {
        clearTimeout(timer);
        request.socket.removeListener('close', cleanup);
        pendingAdmissions.delete(cleanup);
        release();
      };
      const timer = setTimeout(cleanup, 10_000);
      timer.unref();
      pendingAdmissions.add(cleanup);
      request.socket.once('close', cleanup);
      request[admitted] = { key, cleanup, timer };
      callback(null, true);
    },
  });

  io.engine.on('connection', (socket) => {
    const admission = socket.request[admitted];
    if (!admission) return socket.close(true);
    clearTimeout(admission.timer);
    socket.request.socket.removeListener('close', admission.cleanup);
    pendingAdmissions.delete(admission.cleanup);
    socket.once('close', admission.cleanup);
  });

  function isConnected(roomId, playerId) {
    return (connections.get(`${roomId}:${playerId}`)?.size || 0) > 0;
  }

  function emitState(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    const players = room.players.map(({ id, name }) => ({ id, name, connected: isConnected(roomId, id) }));
    for (const player of room.players) {
      const state = {
        roomId,
        you: player.id,
        players,
        game: room.game ? engine.viewFor(room.game, player.id) : null,
      };
      for (const socketId of connections.get(`${roomId}:${player.id}`) || []) {
        io.to(socketId).emit('state', state);
      }
    }
  }

  function detach(socket) {
    const { roomId, playerId } = socket.data;
    if (!roomId || !playerId) return;
    const key = `${roomId}:${playerId}`;
    const active = connections.get(key);
    active?.delete(socket.id);
    if (!active?.size) connections.delete(key);
    delete socket.data.roomId;
    delete socket.data.playerId;
    emitState(roomId);
  }

  function attach(socket, roomId, playerId) {
    if (socket.data.roomId === roomId && socket.data.playerId === playerId) return;
    detach(socket);
    socket.data.roomId = roomId;
    socket.data.playerId = playerId;
    const key = `${roomId}:${playerId}`;
    if (!connections.has(key)) connections.set(key, new Set());
    connections.get(key).add(socket.id);
  }

  io.on('connection', (socket) => {
    // Socket.IO handles upgrades outside Express, so resolve its original request explicitly.
    // Only configured proxy hops may contribute X-Forwarded-For addresses.
    const creationKey = clientKey(socket.request);
    socket.use(([event, ...args], next) => {
      const allowance = abuse.messages.consume(creationKey);
      const authAllowance = allowance.allowed && (event === 'room:join' || event === 'room:resume')
        ? abuse.authentication.consume(creationKey) : allowance;
      if (allowance.allowed && authAllowance.allowed) return next();
      const acknowledge = args.at(-1);
      if (typeof acknowledge === 'function') acknowledge({
        ok: false,
        code: allowance.allowed ? 'AUTH_RATE_LIMIT' : 'REQUEST_RATE_LIMIT',
        error: 'Preveč zahtev s tega omrežja. Poskusi čez trenutek.',
        retryAfterMs: (allowance.allowed ? authAllowance : allowance).retryAfterMs,
      });
      // Do not dispatch denied packets, including unknown events.
    });
    // A small per-connection burst limit also bounds pending writes from a misbehaving client.
    let requestTimes = [];
    function handle(event, operation) {
      socket.on(event, async (payload, acknowledgement) => {
        const acknowledge = typeof acknowledgement === 'function' ? acknowledgement : () => {};
        try {
          if (shuttingDown) throw new RequestError('Strežnik se znova zaganja. Poskusi čez trenutek.');
          const now = Date.now();
          requestTimes = requestTimes.filter((time) => now - time < 10_000);
          if (requestTimes.length >= 80) throw new RequestError('Preveč zahtev. Poskusi čez trenutek.');
          requestTimes.push(now);
          const result = await operation(payload || {});
          acknowledge({ ok: true, ...result });
        } catch (error) {
          if (!(error instanceof RequestError)) logger.error('Room operation failed; private request data omitted.');
          acknowledge({
            ok: false,
            error: error instanceof RequestError ? error.message : 'Zahteve ni bilo mogoče shraniti. Poskusi znova.',
            ...(error instanceof RequestError && error.code ? { code: error.code } : {}),
            ...(error instanceof RequestError && Number.isSafeInteger(error.retryAfterMs)
              ? { retryAfterMs: error.retryAfterMs } : {}),
          });
        }
      });
    }

    handle('room:create', async ({ name }) => {
      // Process-scoped and synchronous: parallel sockets/reconnects share the same quota.
      // Count attempts before validation or disk work; join/resume/play never consume it.
      const allowance = creationLimiter.consume(creationKey);
      if (!allowance.allowed) {
        const minutes = Math.max(1, Math.ceil(allowance.retryAfterMs / 60_000));
        throw new RequestError(`Preveč novih miz s tega omrežja. Poskusi čez ${minutes} min. Obstoječo igro lahko nadaljuješ.`,
          'ROOM_CREATE_LIMIT', allowance.retryAfterMs);
      }
      const { token, player } = createPlayer(cleanName(name));
      let roomId;
      do {
        roomId = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      } while (rooms.has(roomId) || queues.has(roomId) || unrestoredRoomIds.has(roomId));
      return withRoom(roomId, async () => {
        const room = {
          version: 1,
          id: roomId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          players: [player],
          game: null,
        };
        await persist(room);
        rooms.set(roomId, room);
        if (socket.connected) attach(socket, roomId, player.id);
        emitState(roomId);
        return { roomId, token, playerId: player.id };
      });
    });

    handle('room:join', async ({ roomId: inputCode, name }) => {
      const roomId = cleanCode(inputCode);
      const cleanPlayerName = cleanName(name);
      return withRoom(roomId, async () => {
        const current = rooms.get(roomId);
        if (!current) throw new RequestError('Te mize ni. Preveri kodo povabila.');
        if (current.players.length >= 2) throw new RequestError('Miza je že polna. Za nadaljevanje uporabi isto napravo.');
        if (socket.data.roomId === roomId) throw new RequestError('Na tej mizi si že. Povabi drugega igralca.');
        const { token, player } = createPlayer(cleanPlayerName);
        const room = clone(current);
        room.players.push(player);
        room.game = engine.createGame({
          playerIds: room.players.map(({ id }) => id),
          names: room.players.map(({ name: playerName }) => playerName),
        });
        room.updatedAt = new Date().toISOString();
        await persist(room);
        rooms.set(roomId, room);
        if (socket.connected) attach(socket, roomId, player.id);
        emitState(roomId);
        return { roomId, token, playerId: player.id };
      });
    });

    handle('room:resume', async ({ roomId: inputCode, token }) => {
      const roomId = cleanCode(inputCode);
      return withRoom(roomId, async () => {
        const room = rooms.get(roomId);
        const player = room?.players.find((candidate) => matchesToken(candidate, token));
        if (!player) throw new RequestError('Seje ni mogoče obnoviti. Preveri napravo in povabilo.');
        if (socket.connected) attach(socket, roomId, player.id);
        emitState(roomId);
        return { roomId, token, playerId: player.id };
      });
    });

    handle('game:action', async (action) => {
      const { roomId, playerId } = socket.data;
      if (!roomId || !playerId) throw new RequestError('Najprej se pridruži mizi.');
      return withRoom(roomId, async () => {
        const current = rooms.get(roomId);
        if (action.type === 'play') {
          const expected = action.expectedPlay;
          const validContext = expected && typeof expected === 'object' && !Array.isArray(expected) &&
            Number.isSafeInteger(expected.round) && expected.round >= 1 &&
            Number.isSafeInteger(expected.trickNumber) && expected.trickNumber >= 1 && expected.trickNumber <= 27 &&
            Number.isSafeInteger(expected.trickSize) && (expected.trickSize === 0 || expected.trickSize === 1);
          if (!validContext) {
            emitState(roomId);
            throw new RequestError('Podatki o potezi niso veljavni. Osveži stran in poskusi znova.', 'STALE_PLAY');
          }
          if (current?.game?.phase !== 'playing' || expected.round !== current.game.round ||
              expected.trickNumber !== current.game.trickNumber || expected.trickSize !== current.game.trick.length) {
            emitState(roomId);
            throw new RequestError('Igra se je medtem spremenila. Preveri trenutno stanje in izberi potezo znova.', 'STALE_PLAY');
          }
        }
        if (!current?.game) throw new RequestError('Počakaj, da se pridruži še drugi igralec.');
        const room = clone(current);
        try {
          engine.act(room.game, playerId, action);
        } catch (error) {
          throw new RequestError(error.message || 'Ta poteza ni dovoljena.');
        }
        room.updatedAt = new Date().toISOString();
        await persist(room);
        rooms.set(roomId, room);
        emitState(roomId);
        return {};
      });
    });

    handle('room:leave', async () => {
      // Leaving disconnects this tab; seats and reconnect credentials stay valid.
      detach(socket);
      return {};
    });
    socket.on('disconnect', () => detach(socket));
  });

  return {
    app,
    io,
    httpServer,
    async listen(port = Number(process.env.PORT) || 3000, host = '0.0.0.0') {
      await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          resolve();
        });
      });
      return httpServer.address();
    },
    async close() {
      shuttingDown = true;
      for (const cleanup of pendingAdmissions) cleanup();
      await Promise.allSettled([...queues.values()]);
      await new Promise((resolve) => io.close(resolve));
      if (httpServer.listening) await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createTarokServer();
  const address = await server.listen();
  console.log(`TarokZa2 listening on port ${address.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      try {
        await server.close();
        process.exitCode = 0;
      } catch {
        process.exitCode = 1;
      }
    });
  }
}
