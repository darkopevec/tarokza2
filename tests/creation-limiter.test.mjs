import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalClientAddress, createCreationLimiter } from '../server/creation-limiter.mjs';

test('creation quota is shared by a client address across reconnects', () => {
  const limiter = createCreationLimiter({ limit: 2, windowMs: 1000, now: () => 100 });
  const firstSocketKey = canonicalClientAddress('192.0.2.4');
  const reconnectedSocketKey = canonicalClientAddress('::ffff:192.0.2.4');
  assert.deepEqual(limiter.consume(firstSocketKey), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.consume(reconnectedSocketKey), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.consume(firstSocketKey), { allowed: false, retryAfterMs: 1000 });
  assert.equal(limiter.consume('192.0.2.5').allowed, true);
});

test('creation quota expires exactly at its boundary and denied attempts do not extend it', () => {
  let time = 0;
  const limiter = createCreationLimiter({ limit: 1, windowMs: 1000, now: () => time });
  assert.equal(limiter.consume('client').allowed, true);
  time = 999;
  assert.deepEqual(limiter.consume('client'), { allowed: false, retryAfterMs: 1 });
  time = 1000;
  assert.deepEqual(limiter.consume('client'), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.consume('client'), { allowed: false, retryAfterMs: 1000 });
});

test('default quota permits sixty attempts for one hour', () => {
  const limiter = createCreationLimiter({ now: () => 0 });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    assert.equal(limiter.consume('client').allowed, true);
  }
  assert.deepEqual(limiter.consume('client'), { allowed: false, retryAfterMs: 3_600_000 });
});

test('full capacity rejects only new keys and never evicts active quotas', () => {
  let time = 0;
  const limiter = createCreationLimiter({ limit: 2, windowMs: 1000, maxKeys: 2, now: () => time });
  assert.equal(limiter.consume('first').allowed, true);
  time = 100;
  assert.equal(limiter.consume('second').allowed, true);
  for (let index = 0; index < 100; index += 1) {
    assert.deepEqual(limiter.consume(`excess-${index}`), { allowed: false, retryAfterMs: 900 });
  }
  assert.equal(limiter.consume('first').allowed, true);
  assert.equal(limiter.consume('second').allowed, true);
  assert.deepEqual(limiter.consume('first'), { allowed: false, retryAfterMs: 900 });
  assert.deepEqual(limiter.consume('second'), { allowed: false, retryAfterMs: 1000 });
});

test('expired keys free capacity without resetting a still-active key', () => {
  let time = 0;
  const limiter = createCreationLimiter({ limit: 1, windowMs: 1000, maxKeys: 2, now: () => time });
  limiter.consume('first');
  time = 100;
  limiter.consume('second');
  time = 1000;
  assert.equal(limiter.consume('new').allowed, true);
  assert.deepEqual(limiter.consume('second'), { allowed: false, retryAfterMs: 100 });
  assert.deepEqual(limiter.consume('first'), { allowed: false, retryAfterMs: 100 });
  time = 1100;
  assert.equal(limiter.consume('first').allowed, true);
  assert.deepEqual(limiter.consume('new'), { allowed: false, retryAfterMs: 900 });
});

test('a long idle period recycles all expired buckets and backwards clock changes do not reset them', () => {
  let time = 2000;
  const limiter = createCreationLimiter({ limit: 1, windowMs: 1000, maxKeys: 2, now: () => time });
  limiter.consume('one');
  limiter.consume('two');
  time = 1500;
  assert.deepEqual(limiter.consume('one'), { allowed: false, retryAfterMs: 1000 });
  time = 4000;
  assert.equal(limiter.consume('three').allowed, true);
  assert.equal(limiter.consume('four').allowed, true);
  assert.deepEqual(limiter.consume('five'), { allowed: false, retryAfterMs: 1000 });
});

test('address canonicalization unifies IPv4-mapped forms', () => {
  for (const input of ['192.0.2.128', '::ffff:192.0.2.128', '::FFFF:C000:0280', '0:0:0:0:0:ffff:c000:280']) {
    assert.equal(canonicalClientAddress(input), '192.0.2.128', input);
  }
  assert.equal(canonicalClientAddress('::ffff:0:192.0.2.128'), '0:0:0:0::/64');
});

test('IPv6 addresses share their /64 quota despite privacy-address changes', () => {
  const expected = '2001:db8:abcd:1::/64';
  for (const input of [
    '2001:db8:abcd:1::1',
    '2001:0DB8:ABCD:0001:1234:5678:abcd:ffff',
    '2001:db8:abcd:1::192.0.2.1',
  ]) assert.equal(canonicalClientAddress(input), expected, input);
  assert.equal(canonicalClientAddress('2001:db8:abcd:2::1'), '2001:db8:abcd:2::/64');
  assert.equal(canonicalClientAddress('::1'), '0:0:0:0::/64');
  assert.equal(canonicalClientAddress('fe80::1%eth0'), 'fe80:0:0:0::/64');
  const limiter = createCreationLimiter({ limit: 1, now: () => 0 });
  assert.equal(limiter.consume(canonicalClientAddress('2001:db8:abcd:1::1')).allowed, true);
  assert.equal(limiter.consume(canonicalClientAddress('2001:db8:abcd:1::ffff')).allowed, false);
});

test('invalid addresses, hostnames, ports and raw forwarding chains are not quota identities', () => {
  for (const input of [null, undefined, 123, '', 'localhost', ' 192.0.2.1', '192.0.2.1 ',
    '192.000.2.1', '256.0.0.1', '192.0.2.1:1234', '[::1]', '[::1]:443',
    '192.0.2.1, 192.0.2.2', '2001:::1', 'x'.repeat(129)]) {
    assert.equal(canonicalClientAddress(input), null, String(input));
  }
});

test('invalid limiter configuration and unbounded quota keys are rejected', () => {
  for (const field of ['limit', 'windowMs', 'maxKeys']) {
    for (const value of [0, -1, 1.5, NaN, Infinity, '10', Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => createCreationLimiter({ [field]: value }), TypeError);
    }
  }
  assert.throws(() => createCreationLimiter({ now: 0 }), TypeError);
  const limiter = createCreationLimiter({ now: () => 0 });
  for (const key of ['', null, 1, 'a'.repeat(257)]) {
    assert.throws(() => limiter.consume(key), TypeError);
  }
  assert.throws(() => createCreationLimiter({ now: () => NaN }).consume('client'), TypeError);
});
