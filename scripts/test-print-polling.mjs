import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdlePolling } from '../public/print-point/polling.mjs';

test('idle traffic falls at least 70 percent over five minutes without exceeding a five-second sleep', () => {
  let clock = 0, calls = 0;
  const polling = createIdlePolling(() => clock);
  while (clock < 300000) {
    calls++;
    const pause = polling.emptyDelayMs();
    assert.ok(pause >= 1000 && pause <= 5000);
    clock += pause;
  }
  assert.ok(calls <= 90, `idle calls=${calls}, baseline=300`);
});

test('a received ticket immediately restores fast checks and does not impose a delay on bursts', () => {
  let clock = 60000;
  const polling = createIdlePolling(() => clock);
  clock += 60000;
  assert.equal(polling.emptyDelayMs(), 5000);
  polling.received();
  assert.equal(polling.emptyDelayMs(), 1000);
  for (let i = 0; i < 50; i++) { clock += 20; polling.received(); }
  assert.equal(polling.emptyDelayMs(), 1000);
  clock += 10000; assert.equal(polling.emptyDelayMs(), 2000);
  clock += 20000; assert.equal(polling.emptyDelayMs(), 5000);
});
