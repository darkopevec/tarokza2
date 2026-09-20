import { createCreationLimiter } from './creation-limiter.mjs';

// All counters are process-scoped, bounded, and shared across transports/tabs.
export function createAbuseControls(options = {}, now = Date.now) {
  const positive = (name, fallback) => {
    const value = options[name] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid abuse limit: ${name}`);
    return value;
  };
  const maxKeys = positive('maxKeys', 10_000);
  const limiter = (name, fallback, windowMs) => createCreationLimiter({
    limit: positive(name, fallback), windowMs, maxKeys, now,
  });
  const messages = limiter('messages', 600, 10_000);
  const authentication = limiter('authentication', 60, 60_000);
  const handshakes = limiter('handshakes', 60, 60_000);
  const perIp = positive('connectionsPerIp', 20);
  const global = positive('connectionsTotal', 1000);
  const connections = new Map();
  let total = 0;
  return {
    messages, authentication, handshakes,
    acquire(key) {
      const count = connections.get(key) || 0;
      if (count >= perIp || total >= global) return null;
      connections.set(key, count + 1);
      total += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const remaining = connections.get(key) - 1;
        if (remaining) connections.set(key, remaining);
        else connections.delete(key);
        total -= 1;
      };
    },
  };
}
