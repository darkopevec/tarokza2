import express from 'express';
import { openIdentities, IdentityError, hash, validSecret } from './identity.mjs';
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
import { lookupCountry } from './ip-country.mjs';

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
  countryLookup = lookupCountry,
  now = Date.now,
} = {}) {
  const trustProxy = compileTrustedProxies(trustedProxies);
  const abuse = createAbuseControls(abuseLimits, now);
  const admitted = Symbol('tarokAdmission');
  const pendingAdmissions = new Set();
  function clientAddress(request) {
    let address;
    try { address = proxyaddr(request, trustProxy); } catch { /* Use actual peer. */ }
    return isIP(address || '') ? address : request.socket.remoteAddress;
  }
  function clientKey(request) {
    return canonicalClientAddress(clientAddress(request)) || 'unknown-peer';
  }
  const creationLimiter = createCreationLimiter({
    limit: creationLimit.max ?? Number(process.env.ROOM_CREATE_LIMIT ?? 60),
    windowMs: creationLimit.windowMs ?? Number(process.env.ROOM_CREATE_WINDOW_MS ?? 3_600_000),
    maxKeys: creationLimit.maxKeys ?? 10_000,
    now,
  });
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const identities = await openIdentities(dataDir, now);
  const rooms = new Map();
  const unrestoredRoomIds = new Set();
  const queues = new Map();
  const connections = new Map();
  let shuttingDown = false;

  for (const filename of await readdir(dataDir)) {
    if (!/^[A-HJ-NP-Z2-9]{6}\.json$/.test(filename)) continue;
    try {
      const room = JSON.parse(await readFile(path.join(dataDir, filename), 'utf8'));
      if (![1, 2].includes(room.version) || room.id !== filename.slice(0, 6) ||
          !Array.isArray(room.players) || room.players.length < 1 || room.players.length > 2 ||
          room.players.some((player) => typeof player.id !== 'string' ||
            typeof player.name !== 'string' || (player.userId && !identities.hasUser(player.userId)) || !(typeof player.userId === 'string' || /^[a-f0-9]{64}$/.test(player.tokenHash)))) {
        throw new Error('Invalid room record');
      }
      // Resume old preparation screens directly into play, retaining cards and scores.
      if (room.game) defaultEngine.resumeGame(room.game);
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
    const ok = !shuttingDown && unrestoredRoomIds.size === 0 && !identities.degraded;
    response.setHeader('Cache-Control', 'no-store');
    response.status(ok ? 200 : 503).json({
      ok,
      restoration: { status: unrestoredRoomIds.size || identities.degraded ? 'degraded' : 'ok', failedRooms: unrestoredRoomIds.size, ...(identities.degraded ? { identityRegistry: 'degraded' } : {}) },
    });
  });
  app.get('/api/locale', (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.vary('X-Forwarded-For');
    let country = null;
    try {
      const result = countryLookup(clientAddress(request));
      if (typeof result === 'string' && /^[A-Z]{2}$/.test(result)) country = result;
    } catch { /* The browser language remains available if lookup fails. */ }
    response.json({ country });
  });
  // Public artwork can be reused across moves, reconnects and page reloads.
  // Keep HTML and private game endpoints on their existing cache policies.
  app.get('/card-cache-sw.js', (_request, response) => {
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(path.join(distDir, 'card-cache-sw.js'));
  });
  app.use('/cards', express.static(path.join(distDir, 'cards'), { maxAge: '1y', immutable: true, index: false }));
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

  function tables(userId) {
    return [...rooms.values()].filter(room => room.players.some(p => identities.owner(room.id, p) === userId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(room => ({ roomId: room.id, updatedAt: room.updatedAt,
        opponent: room.players.find(p => identities.owner(room.id, p) !== userId)?.name || null,
        status: room.game ? room.game.phase : 'waiting' }));
  }
  function emitTables() {
    for (const client of io.sockets.sockets.values()) {
      try { if (client.data.credential) client.emit('tables', tables(identities.user(client.data.credential).id)); } catch { /* Revoked socket. */ }
    }
  }
  function emitState(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    const players = room.players.map(({ id, name }) => ({ id, name, connected: isConnected(roomId, id) }));
    for (const player of room.players) {
      const state = {
        roomId,
        revision: room.revision || 0,
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
      const authAllowance = allowance.allowed && (event !== 'game:action' && event !== 'room:leave')
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
          if (!(error instanceof RequestError) && !(error instanceof IdentityError)) logger.error('Room operation failed; private request data omitted.');
          acknowledge({
            ok: false,
            error: (error instanceof RequestError || error instanceof IdentityError) ? error.message : 'Zahteve ni bilo mogoče shraniti. Poskusi znova.',
            ...((error instanceof RequestError || error instanceof IdentityError) && error.code ? { code: error.code } : {}),
            ...(error instanceof RequestError && Number.isSafeInteger(error.retryAfterMs)
              ? { retryAfterMs: error.retryAfterMs } : {}),
          });
        }
      });
    }

    const authenticate = () => identities.user(socket.data.credential);
    function publicUser(user) { return { id: user.id, name: user.name }; }
    function signedIn(credential) {
      const user = identities.user(credential);
      socket.data.credential = credential;
      return { user: publicUser(user), tables: tables(user.id) };
    }
    handle('identity:create', async ({ name, credential }) => {
      if (socket.data.credential) return signedIn(socket.data.credential);
      await identities.create(cleanName(name), credential);
      return signedIn(credential);
    });
    handle('identity:resume', async ({ credential }) => {
      if (socket.data.credential && identities.user(socket.data.credential).id !== identities.user(credential).id)
        throw new IdentityError('Brskalnik že pripada drugemu igralcu.', 'IDENTITY_CONFLICT');
      return signedIn(credential);
    });
    handle('tables:list', async () => ({ tables: tables(authenticate().id) }));
    handle('devices:list', async () => ({ devices: identities.list(socket.data.credential) }));
    handle('devices:rename', async ({ id, name }) => { await identities.rename(socket.data.credential, id, cleanName(name)); return {}; });
    handle('devices:revoke', async ({ id }) => {
      await identities.revoke(socket.data.credential, id);
      for (const client of io.sockets.sockets.values()) {
        if (!client.data.credential) continue;
        try { identities.device(client.data.credential); } catch { client.emit('identity:revoked'); client.disconnect(true); }
      }
      return {};
    });
    handle('devices:link', async () => {
      const token = randomBytes(32).toString('base64url');
      return { token, ...await identities.link(socket.data.credential, token) };
    });
    handle('recovery:create', async () => {
      const token = randomBytes(32).toString('base64url');
      await identities.recovery(socket.data.credential, token);
      return { token };
    });
    handle('identity:redeem', async ({ kind, token, credential, existingCredential }) => {
      if (!['device', 'recovery'].includes(kind)) throw new IdentityError('Neveljavna povezava.');
      const existing = socket.data.credential || existingCredential;
      const result = await identities.redeem(kind, token, credential, existing);
      return { ...signedIn(result.alreadyConnected ? existing : credential), alreadyConnected: result.alreadyConnected || false };
    });
    handle('identity:legacy', async ({ roomId: inputCode, token }) => {
      authenticate();
      const roomId = cleanCode(inputCode);
      const seat = rooms.get(roomId)?.players.find(p => p.tokenHash && matchesToken(p, token));
      if (!seat) throw new IdentityError('Starega mesta ni mogoče obnoviti.', 'INVALID_CLAIM');
      return { name: seat.name, playerId: seat.id };
    });
    handle('identity:claim', async ({ roomId: inputCode, token }) => {
      authenticate();
      const roomId = cleanCode(inputCode);
      return withRoom(roomId, async () => {
        const room = rooms.get(roomId);
        const seat = room?.players.find(p => p.tokenHash && matchesToken(p, token));
        if (!seat) throw new IdentityError('Starega mesta ni mogoče obnoviti.', 'INVALID_CLAIM');
        await identities.claim(socket.data.credential, roomId, seat, room.players);
        emitTables();
        return {};
      });
    });
    handle('room:create', async () => {
      const allowance = creationLimiter.consume(creationKey);
      if (!allowance.allowed) throw new RequestError('Preveč novih miz. Poskusi pozneje.', 'ROOM_CREATE_LIMIT', allowance.retryAfterMs);
      const user = authenticate();
      let roomId;
      do { roomId = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''); }
      while (rooms.has(roomId) || queues.has(roomId) || unrestoredRoomIds.has(roomId));
      return withRoom(roomId, async () => {
        authenticate();
        const player = { id: randomUUID(), name: user.name, userId: user.id };
        const invitation = randomBytes(32).toString('base64url');
        const room = { version: 2, id: roomId, revision: 0, createdAt: new Date(now()).toISOString(),
          updatedAt: new Date(now()).toISOString(), players: [player], game: null, invitationHash: hash(invitation) };
        await persist(room);
        rooms.set(roomId, room);
        if (socket.connected) attach(socket, roomId, player.id);
        emitState(roomId); emitTables();
        return { roomId, playerId: player.id, invitation };
      });
    });
    handle('room:invite', async ({ roomId: inputCode }) => {
      const roomId = cleanCode(inputCode);
      return withRoom(roomId, async () => {
        const user = authenticate();
        const current = rooms.get(roomId);
        if (!current || !current.players.some(p => identities.owner(roomId, p) === user.id) || current.players.length !== 1)
          throw new RequestError('Povabila ni mogoče ustvariti.');
        const invitation = randomBytes(32).toString('base64url');
        const room = { ...current, invitationHash: hash(invitation) };
        await persist(room); rooms.set(roomId, room);
        return { roomId, invitation };
      });
    });
    handle('room:join', async ({ roomId: inputCode, invitation }) => {
      const roomId = cleanCode(inputCode);
      return withRoom(roomId, async () => {
        const user = authenticate();
        const current = rooms.get(roomId);
        const own = current?.players.find(p => identities.owner(roomId, p) === user.id);
        if (own) { if (socket.connected) attach(socket, roomId, own.id); emitState(roomId); return { roomId, playerId: own.id }; }
        if (!current || !validSecret(invitation) || current.invitationHash !== hash(invitation)) throw new RequestError('Povabilo ni veljavno ali je že uporabljeno.', 'INVALID_INVITE');
        if (current.players.length >= 2) throw new RequestError('Miza je že polna.');
        const player = { id: randomUUID(), name: user.name, userId: user.id };
        const room = clone(current);
        room.players.push(player); delete room.invitationHash;
        room.game = engine.createGame({ playerIds: room.players.map(p => p.id), names: room.players.map(p => p.name) });
        room.revision = (room.revision || 0) + 1;
        room.updatedAt = new Date(now()).toISOString();
        await persist(room); rooms.set(roomId, room);
        if (socket.connected) attach(socket, roomId, player.id);
        emitState(roomId); emitTables();
        return { roomId, playerId: player.id };
      });
    });
    handle('room:resume', async ({ roomId: inputCode }) => {
      const roomId = cleanCode(inputCode);
      return withRoom(roomId, async () => {
        const user = authenticate();
        const player = rooms.get(roomId)?.players.find(p => identities.owner(roomId, p) === user.id);
        if (!player) throw new RequestError('Ta miza ne pripada tvojemu igralcu.');
        if (socket.connected) attach(socket, roomId, player.id);
        emitState(roomId);
        return { roomId, playerId: player.id };
      });
    });

    handle('game:action', async (action) => {
      authenticate();
      const { roomId, playerId } = socket.data;
      if (!roomId || !playerId) throw new RequestError('Najprej se pridruži mizi.');
      return withRoom(roomId, async () => {
        authenticate();
        const current = rooms.get(roomId);
        if (action.expectedRevision !== (current?.revision || 0)) {
          emitState(roomId);
          throw new RequestError('Igra se je spremenila. Preveri stanje in poskusi znova.', 'STALE_ACTION');
        }
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
        room.revision = (room.revision || 0) + 1;
        room.updatedAt = new Date(now()).toISOString();
        await persist(room);
        rooms.set(roomId, room);
        emitState(roomId); emitTables();
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
      await identities.close();
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
