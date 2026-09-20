import test from 'node:test';
import assert from 'node:assert/strict';
import { createAbuseControls } from '../server/abuse-controls.mjs';

test('connection release is idempotent and cannot free another connection slot', () => {
  const controls = createAbuseControls({ connectionsPerIp: 1, connectionsTotal: 2 });
  const release = controls.acquire('a');
  assert.equal(controls.acquire('a'), null);
  release();
  const replacement = controls.acquire('a');
  release();
  assert.equal(controls.acquire('a'), null);
  const second = controls.acquire('b');
  assert.equal(controls.acquire('c'), null);
  replacement();
  second();
  assert.equal(typeof controls.acquire('c'), 'function');
});

test('invalid abuse limits fail closed', () => {
  for (const name of ['messages', 'authentication', 'handshakes', 'connectionsPerIp', 'connectionsTotal', 'maxKeys']) {
    for (const value of [0, -1, Infinity, 1.5, '20']) {
      assert.throws(() => createAbuseControls({ [name]: value }), TypeError);
    }
  }
});
