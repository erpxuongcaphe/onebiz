import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDurableQueue, acquireReceiverLease } from '../public/print-point/durable-queue.mjs';
import { createAgentRpc } from '../public/print-point/recovery.mjs';
const point = '20000000-0000-0000-0000-000000000001';
async function fixture(rpc) { const folder = await mkdtemp(join(tmpdir(), 'onebiz-durable-')); return { folder, queue: createDurableQueue(folder, point, rpc) }; }
test('lost claim response recovers same intent across restart; physical send once', async () => {
  let requestId, calls = 0, sends = 0;
  const id = randomUUID();
  const rpc = async (action, data) => {
    if (action === 'finish') return { ok: true };
    if (!requestId) requestId = data.request_id;
    assert.equal(data.request_id, requestId);
    if (++calls === 1) throw new Error('PRINT_RPC_TIMEOUT');
    return { id, claim_id: requestId };
  };
  const { folder, queue } = await fixture(rpc);
  await assert.rejects(queue.claim(), /TIMEOUT/);
  const resumed = createDurableQueue(folder, point, rpc), job = await resumed.claim();
  sends++; await resumed.finish(job, 'handed_off', 'Windows accepted');
  assert.equal(sends, 1); assert.equal(calls, 2); assert.equal((await readdir(folder)).length, 0);
});
test('crash after physical send restores unknown acknowledgement, never returns bytes', async () => {
  const calls = [], id = randomUUID();
  const rpc = async (action, data) => { calls.push({ action, data }); return action === 'claim' ? { id, claim_id: data.request_id, bytes: 'not-for-replay' } : { ok: true }; };
  const { folder, queue } = await fixture(rpc);
  await queue.claim(); // caller might have printed; no finish persisted before crash
  const resumed = createDurableQueue(folder, point, rpc);
  assert.deepEqual(await resumed.claim(), { recovered: true });
  assert.equal(calls.length, 2); assert.equal(calls[1].action, 'finish'); assert.equal(calls[1].data.status, 'unknown');
});
test('repeated finish loss holds result through restart without claiming other jobs', async () => {
  let finishes = 0, claims = 0;
  const rpc = async (action, data) => {
    if (action === 'claim') { claims++; return { id: randomUUID(), claim_id: data.request_id }; }
    assert.equal(data.status, 'handed_off');
    if (++finishes < 5) throw new Error('PRINT_RPC_TIMEOUT'); return { ok: true };
  };
  const { folder, queue } = await fixture(rpc), job = await queue.claim();
  await assert.rejects(queue.finish(job, 'handed_off', 'accepted'), /TIMEOUT/);
  for (let i = 0; i < 3; i++) await assert.rejects(createDurableQueue(folder, point, rpc).claim(), /TIMEOUT/);
  assert.deepEqual(await createDurableQueue(folder, point, rpc).claim(), { recovered: true });
  assert.equal(claims, 1); assert.equal(finishes, 5);
});
test('expired claim archives metadata for review without replaying or keeping point stuck', async () => {
  const rpc = async (action, data) => { if (action === 'claim') return { id: randomUUID(), claim_id: data.request_id }; const error = new Error('expired'); error.claimExpired = true; throw error; };
  const { folder, queue } = await fixture(rpc), job = await queue.claim();
  await queue.finish(job, 'unknown', 'check paper');
  assert.match((await readdir(folder))[0], /expired-/);
});
test('corrupt/cross-point journal refuses a claim rather than dropping the record', async () => {
  let calls = 0; const { folder, queue } = await fixture(async () => { calls++; });
  await writeFile(join(folder, `pending-send-${point}.json`), JSON.stringify({ version: 1, pointId: randomUUID(), requestId: randomUUID() }));
  await assert.rejects(queue.claim(), /JOURNAL_INVALID/); assert.equal(calls, 0);
});
test('100 consecutive jobs: ordered single send, no timer between successful jobs', async () => {
  let claimed = 0, sending = false; const output = [];
  const rpc = async (action, data) => {
    if (action === 'finish') { assert.equal(sending, true); sending = false; return { ok: true }; }
    assert.equal(sending, false); if (claimed === 100) return null;
    sending = true; return { id: randomUUID(), claim_id: data.request_id, sequence: claimed++ };
  };
  const { queue } = await fixture(rpc);
  for (let i = 0; i < 100; i++) { const job = await queue.claim(); output.push(job.sequence); await queue.finish(job, 'handed_off', 'accepted'); }
  assert.equal(await queue.claim(), null); assert.deepEqual(output, Array.from({ length: 100 }, (_, i) => i));
});
test('exclusive lease prevents two Node receivers sharing a journal and releases on close', async () => {
  const id = randomUUID(), release = await acquireReceiverLease(id);
  try { await assert.rejects(acquireReceiverLease(id), /ALREADY_RUNNING/); } finally { release(); }
  await new Promise(resolve => setTimeout(resolve, 20)); const second = await acquireReceiverLease(id); second();
});
test('delayed healthy heartbeat cannot clear a concurrent failure cooldown', async () => {
  let resolve, calls = 0;
  const rpc = createAgentRpc({ url: 'https://test.invalid' }, async () => {
    if (++calls === 1) return new Promise(r => { resolve = r; });
    return { ok: false, status: 503 };
  });
  const heartbeat = rpc('heartbeat'); await assert.rejects(rpc('claim'), /503/);
  resolve({ ok: true, json: async () => ({ ok: true }) }); await heartbeat;
  await assert.rejects(rpc('claim'), /BACKOFF/); assert.equal(calls, 2);
});
test('finish parser recognizes only explicit expired code, not arbitrary response text', async () => {
  const rpc = createAgentRpc({ url: 'https://test.invalid' }, async () => ({ ok: false, status: 400, json: async () => ({ message: 'PRINT_CLAIM_EXPIRED' }) }));
  await assert.rejects(rpc('finish'), e => e.claimExpired === true && e.message === 'PRINT_RPC_HTTP_400');
});
