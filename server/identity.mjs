import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const validSecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export class IdentityError extends Error {
  constructor(message, code = 'IDENTITY_ERROR') { super(message); this.code = code; }
}
const fail = (message, code) => { throw new IdentityError(message, code); };
export async function openIdentities(dataDir, now = Date.now) {
  const filename = path.join(dataDir, 'identities.json');
  let data = { version: 1, users: {}, devices: {}, links: {}, claims: {} };
  let degraded = false;
  try {
    const saved = JSON.parse(await readFile(filename, 'utf8'));
    if (saved.version !== 1 || ['users', 'devices', 'links', 'claims'].some(key => !saved[key] || typeof saved[key] !== 'object' || Array.isArray(saved[key]))) throw Error();
    for (const [id, user] of Object.entries(saved.users)) if (user.id !== id || typeof user.name !== 'string' || (user.nameUpdatedAt !== undefined && !Number.isFinite(user.nameUpdatedAt)) || (user.recoveryHash !== undefined && !/^[a-f0-9]{64}$/.test(user.recoveryHash))) throw Error();
    for (const [key, device] of Object.entries(saved.devices)) if (!/^[a-f0-9]{64}$/.test(key) || !saved.users[device.userId] || typeof device.id !== 'string') throw Error();
    for (const link of Object.values(saved.links)) if (!saved.users[link.userId] || !Number.isFinite(link.expiresAt)) throw Error();
    for (const userId of Object.values(saved.claims)) if (!saved.users[userId]) throw Error();
    data = saved;
  } catch (error) { if (error.code !== 'ENOENT') degraded = true; }
  let queue = Promise.resolve();
  function available() { if (degraded) fail('Dostop do igralcev trenutno ni na voljo.', 'IDENTITY_UNAVAILABLE'); }
  function mutate(fn) {
    const operation = queue.catch(() => {}).then(async () => {
      available();
      const next = structuredClone(data);
      const result = fn(next);
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); await rename(temporary, filename); }
      catch (error) { await unlink(temporary).catch(() => {}); throw error; }
      data = next;
      return result;
    });
    queue = operation;
    return operation;
  }
  function device(secret) {
    available();
    const found = validSecret(secret) && data.devices[hash(secret)];
    if (!found) fail('Ta naprava nima več dostopa. Uporabi povezavo za novo napravo ali obnovitev.', 'AUTH_REQUIRED');
    return found;
  }
  function addDevice(next, secret, userId) {
    if (!validSecret(secret)) fail('Neveljaven ključ naprave.');
    const key = hash(secret);
    if (next.devices[key]) {
      if (next.devices[key].userId !== userId) fail('Brskalnik že pripada drugemu igralcu. Uporabi drug profil brskalnika.', 'IDENTITY_CONFLICT');
      return next.devices[key];
    }
    return next.devices[key] = { id: randomUUID(), userId, name: 'Brskalnik', createdAt: now() };
  }
  return {
    get degraded() { return degraded; },
    device,
    hasUser: userId => Object.hasOwn(data.users, userId),
    user: secret => data.users[device(secret).userId],
    owner: (roomId, seat) => seat.userId || data.claims[`${roomId}:${seat.id}`],
    displayName(roomId, seat) {
      const user = data.users[seat.userId || data.claims[`${roomId}:${seat.id}`]];
      // Claiming an old seat retains its historical name until the player
      // explicitly changes their name for all tables.
      return user && (seat.userId || user.nameUpdatedAt !== undefined) ? user.name : seat.name;
    },
    async create(name, secret) {
      return mutate(next => {
        if (!validSecret(secret)) fail('Neveljaven ključ naprave.');
        const existing = next.devices[hash(secret)];
        if (existing) return next.users[existing.userId];
        const user = { id: randomUUID(), name };
        next.users[user.id] = user;
        addDevice(next, secret, user.id);
        return user;
      });
    },
    list(secret) { const current = device(secret); return Object.values(data.devices).filter(d => d.userId === current.userId).map(d => ({ id: d.id, name: d.name, createdAt: d.createdAt, current: d.id === current.id })); },
    async renameUser(secret, name) { return mutate(next => {
      // Revalidate inside the registry queue, including revocations that were
      // queued before this change.
      const user = next.users[device(secret).userId];
      user.name = name;
      user.nameUpdatedAt = now();
      return user;
    }); },
    async rename(secret, id, name) { return mutate(next => { const current = device(secret); const target = Object.values(next.devices).find(d => d.id === id && d.userId === current.userId); if (!target) fail('Naprave ni.'); target.name = name; }); },
    async revoke(secret, id) { return mutate(next => { const current = device(secret); if (current.id === id) fail('Trenutne naprave ni mogoče odstraniti.'); for (const [key, d] of Object.entries(next.devices)) if (d.id === id && d.userId === current.userId) delete next.devices[key]; }); },
    async link(secret, token) { return mutate(next => { const current = device(secret); for (const [key, link] of Object.entries(next.links)) if (link.expiresAt <= now() || link.userId === current.userId) delete next.links[key]; const expiresAt = now() + 15 * 60_000; next.links[hash(token)] = { userId: current.userId, expiresAt }; return { expiresAt }; }); },
    async recovery(secret, token) { return mutate(next => { next.users[device(secret).userId].recoveryHash = hash(token); }); },
    async redeem(kind, token, secret, existingSecret) {
      return mutate(next => {
        if (!validSecret(token)) fail('Povezava ni veljavna ali je potekla.', 'INVALID_LINK');
        const link = kind === 'device' ? next.links[hash(token)] : null;
        const userId = kind === 'device' ? (link?.expiresAt > now() && link.userId) : Object.values(next.users).find(u => u.recoveryHash === hash(token))?.id;
        const priorDevice = validSecret(secret) && next.devices[hash(secret)];
        if (kind === 'device' && !userId && priorDevice?.redeemedLinkHash === hash(token) && (!existingSecret || existingSecret === secret)) return { user: next.users[priorDevice.userId], alreadyConnected: !!existingSecret };
        if (!userId) fail('Povezava ni veljavna ali je potekla.', 'INVALID_LINK');
        if (existingSecret) {
          const current = device(existingSecret);
          if (current.userId !== userId) fail('Brskalnik že pripada drugemu igralcu. Uporabi drug profil brskalnika.', 'IDENTITY_CONFLICT');
          return { user: next.users[userId], alreadyConnected: true };
        }
        const added = addDevice(next, secret, userId);
        if (kind === 'device') { added.redeemedLinkHash = hash(token); delete next.links[hash(token)]; }
        return { user: next.users[userId] };
      });
    },
    async claim(secret, roomId, seat, seats) { return mutate(next => {
      const user = device(secret).userId;
      const owner = candidate => candidate.userId || next.claims[`${roomId}:${candidate.id}`];
      if (owner(seat) && owner(seat) !== user) fail('Mesto že pripada drugemu igralcu.', 'CLAIM_CONFLICT');
      if (seats.some(other => other.id !== seat.id && owner(other) === user)) fail('Obeh mest ne moreš povezati z istim igralcem.', 'SEAT_CONFLICT');
      next.claims[`${roomId}:${seat.id}`] = user;
    }); },
    close: () => queue.catch(() => {}),
  };
}
