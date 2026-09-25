import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';
import { canonicalClientAddress } from './creation-limiter.mjs';

const require = createRequire(import.meta.url);
const nonPublic = proxyaddr.compile([
  'loopback', 'linklocal', 'uniquelocal',
  '0.0.0.0/8', '100.64.0.0/10', '192.0.0.0/24', '192.0.2.0/24',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
  '::/128', '2001:db8::/32', 'ff00::/8',
]);
let database;
let unavailable = false;

/** Local, country-only lookup. No visitor IP is logged, stored or sent elsewhere. */
export function lookupCountry(address) {
  if (typeof address !== 'string' || !isIP(address)) return null;
  // The quota helper also normalizes IPv4-mapped IPv6, but a real IPv6 lookup
  // needs the entire address, not the /64 used for rate limiting.
  const normalized = canonicalClientAddress(address);
  const ip = isIP(normalized) === 4 ? normalized : address.split('%', 1)[0];
  if (nonPublic(ip) || unavailable) return null;
  try {
    database ||= require('geoip-country');
    const country = database.lookup(ip)?.country;
    return typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null;
  } catch {
    // Country detection must never prevent a visitor from using the game.
    if (!database) unavailable = true;
    return null;
  }
}
