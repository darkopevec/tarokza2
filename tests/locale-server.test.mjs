import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createTarokServer } from '../server/index.mjs';
import { lookupCountry } from '../server/ip-country.mjs';

const quietLogger = { warn() {}, error() {} };
const trustedLoopback = ['127.0.0.1', '::1'];

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tarok-locale-test-'));
  const server = await createTarokServer({ dataDir, logger: quietLogger, trustedProxies: [], ...options });
  t.after(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const address = await server.listen(0, '127.0.0.1');
  return (headers = {}, query = '') => fetch(`http://127.0.0.1:${address.port}/api/locale${query}`, { headers });
}

function assertPrivateResponse(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json\b/);
  assert.match(response.headers.get('cache-control'), /\bprivate\b/);
  assert.match(response.headers.get('cache-control'), /\bno-store\b/);
  assert.ok(response.headers.get('vary').toLowerCase().split(/\s*,\s*/).includes('x-forwarded-for'));
}

test('locale detection returns no country for a local connection and cannot be cached', async (t) => {
  const request = await fixture(t);
  const response = await request();
  assertPrivateResponse(response);
  assert.deepEqual(await response.json(), { country: null });
});

test('locale detection ignores untrusted forwarded addresses, country headers, and query addresses', async (t) => {
  const addresses = [];
  const request = await fixture(t, {
    countryLookup(address) { addresses.push(address); return 'SI'; },
  });
  const response = await request({
    'X-Forwarded-For': '8.8.8.8',
    'X-Real-IP': '1.1.1.1',
    'CF-Connecting-IP': '9.9.9.9',
    'CF-IPCountry': 'US',
    'X-Vercel-IP-Country': 'DE',
    'X-Country-Code': 'ES',
    Forwarded: 'for=8.8.8.8',
  }, '?ip=8.8.8.8&country=ES');
  assertPrivateResponse(response);
  assert.deepEqual(addresses, ['127.0.0.1']);
  assert.deepEqual(await response.json(), { country: 'SI' }, 'Only the resolved country is exposed to the browser');
});

test('trusted proxies pass the full public IPv4 or IPv6 address into local country lookup', async (t) => {
  const addresses = [];
  const request = await fixture(t, {
    trustedProxies: trustedLoopback,
    countryLookup(address) { addresses.push(address); return 'DE'; },
  });
  for (const address of ['8.8.8.8', '2001:4860:4860::8888']) {
    const response = await request({ 'X-Forwarded-For': address });
    assertPrivateResponse(response);
    assert.deepEqual(await response.json(), { country: 'DE' });
    assert.equal(addresses.at(-1), address, 'Geolocation must receive the host address, not the IPv6 /64 quota key');
  }
});

test('locale detection walks trusted proxy chains only as far as the first untrusted address', async (t) => {
  const addresses = [];
  const request = await fixture(t, {
    trustedProxies: [...trustedLoopback, '10.10.0.0/16'],
    countryLookup(address) { addresses.push(address); return 'AT'; },
  });
  const response = await request({ 'X-Forwarded-For': '1.1.1.1, 8.8.8.8, 10.10.0.5' });
  assert.deepEqual(await response.json(), { country: 'AT' });
  assert.deepEqual(addresses, ['8.8.8.8'], 'The untrusted hop cannot supply an earlier client address');
});

test('malformed forwarded addresses fall back to the socket peer for country lookup', async (t) => {
  const addresses = [];
  const request = await fixture(t, {
    trustedProxies: trustedLoopback,
    countryLookup(address) { addresses.push(address); return null; },
  });
  for (const value of ['not-an-ip', '8.8.8.8:443', '1.1.1.1, not-an-ip']) {
    const response = await request({ 'X-Forwarded-For': value });
    assert.deepEqual(await response.json(), { country: null });
    assert.equal(addresses.at(-1), '127.0.0.1');
  }
});

test('unavailable or invalid country lookup results safely leave language selection to the client', async (t) => {
  const results = [null, undefined, '', 'USA', 'si', 42, { country: 'SI' }];
  const request = await fixture(t, {
    countryLookup() {
      if (!results.length) throw new Error('Country data unavailable');
      return results.shift();
    },
  });
  for (let index = 0; index < 8; index += 1) {
    const response = await request();
    assertPrivateResponse(response);
    assert.deepEqual(await response.json(), { country: null });
  }
});

test('local country data resolves public IPv4, IPv6, and IPv4-mapped IPv6 addresses', () => {
  const ipv4Country = lookupCountry('8.8.8.8');
  assert.match(ipv4Country, /^[A-Z]{2}$/);
  assert.match(lookupCountry('2001:4860:4860::8888'), /^[A-Z]{2}$/);
  assert.equal(lookupCountry('::ffff:8.8.8.8'), ipv4Country);
  assert.equal(lookupCountry('::ffff:808:808'), ipv4Country);
});

test('local country lookup returns no country for private, reserved, or invalid addresses', () => {
  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '192.168.1.1', '192.0.2.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:192.168.1.1',
    '', 'not-an-ip', '8.8.8.8:443', '8.8.8.8/32', null, undefined,
  ]) {
    assert.equal(lookupCountry(address), null, `No public country for ${JSON.stringify(address)}`);
  }
});
