import { isIP } from 'node:net';

/**
 * One quota per IPv4 address or IPv6 /64, independent of socket identity.
 * Never use untrusted forwarding headers as this input without resolving proxies first.
 */
export function canonicalClientAddress(address) {
  if (typeof address !== 'string' || address.length > 128) return null;
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return null;

  // Interface zones do not create separate public-client quotas.
  let value = address.split('%', 1)[0].toLowerCase();
  if (value.includes('.')) {
    const separator = value.lastIndexOf(':');
    const bytes = value.slice(separator + 1).split('.').map(Number);
    value = `${value.slice(0, separator + 1)}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = value.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const words = (halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left).map((word) => Number.parseInt(word, 16));

  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
  }
  return `${words.slice(0, 4).map((word) => word.toString(16)).join(':')}::/64`;
}

/**
 * Bounded fixed-window quota. Share one instance across all server connections.
 * Denied attempts never extend the window; active keys are never evicted.
 * At capacity, previously unseen keys wait for the earliest bucket to expire.
 */
export function createCreationLimiter({
  limit = 60,
  windowMs = 60 * 60 * 1000,
  maxKeys = 10_000,
  now = Date.now,
} = {}) {
  for (const [name, value] of Object.entries({ limit, windowMs, maxKeys })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function.');

  const buckets = new Map();
  let latestTime = -Infinity;

  return {
    consume(key) {
      if (typeof key !== 'string' || !key.length || key.length > 256) {
        throw new TypeError('A quota key must contain between 1 and 256 characters.');
      }
      const reading = now();
      if (!Number.isFinite(reading)) throw new TypeError('now must return a finite number.');
      // Wall-clock corrections must not reset an active quota or reorder its expiry.
      const time = Math.max(latestTime, reading);
      latestTime = time;

      // All windows have the same duration. Insertion order is therefore expiry
      // order, and cleanup is amortized O(1) without an interval or a full scan.
      for (const [oldKey, bucket] of buckets) {
        if (bucket.expiresAt > time) break;
        buckets.delete(oldKey);
      }

      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxKeys) {
          const oldest = buckets.values().next().value;
          return { allowed: false, retryAfterMs: Math.ceil(oldest.expiresAt - time) };
        }
        bucket = { count: 0, expiresAt: time + windowMs };
        buckets.set(key, bucket);
      }
      if (bucket.count >= limit) {
        return { allowed: false, retryAfterMs: Math.ceil(bucket.expiresAt - time) };
      }
      bucket.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}
