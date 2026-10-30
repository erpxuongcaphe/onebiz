import { open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// OS releases this exclusive local lease on crash/reboot. It carries no data,
// credentials or print API. A collision fails closed instead of running twice.
export async function acquireReceiverLease(pointId) {
  const port = 49152 + createHash('sha256').update(pointId).digest().readUInt16BE(0) % 16384;
  const server = createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error('PRINT_RECEIVER_ALREADY_RUNNING_OR_LEASE_BUSY')));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  return () => server.close();
}

export function createDurableQueue(folder, pointId, rpc) {
  if (!uuid.test(pointId)) throw new Error('INVALID_POINT_ID');
  const path = join(folder, `pending-send-${pointId}.json`);
  async function read() {
    try {
      const text = await readFile(path, 'utf8');
      if (text.length > 8192) throw new Error('PRINT_JOURNAL_INVALID');
      const state = JSON.parse(text);
      if (state.version !== 1 || state.pointId !== pointId || !uuid.test(state.requestId)) throw new Error('PRINT_JOURNAL_INVALID');
      if (state.ack && (!uuid.test(state.ack.id) || state.ack.claim_id !== state.requestId ||
        !['handed_off', 'failed', 'unknown'].includes(state.ack.status) || typeof state.ack.message !== 'string' || state.ack.message.length > 300)) throw new Error('PRINT_JOURNAL_INVALID');
      return state;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function save(state) {
    const temp = `${path}.${randomUUID()}.tmp`;
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
    finally { await file.close(); }
    try { await rename(temp, path); }
    catch (error) { await unlink(temp).catch(() => {}); throw error; }
  }
  async function acknowledge(state) {
    try {
      const result = await rpc('finish', state.ack);
      if (result?.ok !== true) throw new Error('PRINT_ACK_INVALID');
      await unlink(path);
    } catch (error) {
      if (!error.claimExpired) throw error;
      // Keep a review record, never turn a physically uncertain send into a retry.
      await rename(path, `${path}.expired-${randomUUID()}`);
    }
  }
  return {
    async claim() {
      let state = await read();
      if (state?.ack) { await acknowledge(state); return { recovered: true }; }
      if (!state) {
        state = { version: 1, pointId, requestId: randomUUID() };
        await save(state);
      }
      const job = await rpc('claim', { request_id: state.requestId });
      if (job === null) { await unlink(path); return null; }
      if (!job || !uuid.test(job.id) || job.claim_id !== state.requestId) throw new Error('PRINT_RECOVERY_PROTOCOL_MISMATCH');
      // Persist uncertainty BEFORE the caller can touch USB/LAN. On any crash,
      // restart may acknowledge only; the original bytes never go to paper again.
      state.ack = { id: job.id, claim_id: job.claim_id, status: 'unknown', message: 'Bộ nhận bị ngắt trong lúc xử lý. Kiểm tra giấy trước khi in lại.' };
      await save(state);
      return job;
    },
    async finish(job, status, message) {
      const state = await read();
      if (!state?.ack || state.ack.id !== job.id || state.requestId !== job.claim_id || !['handed_off', 'failed', 'unknown'].includes(status)) throw new Error('PRINT_JOURNAL_MISMATCH');
      state.ack = { id: job.id, claim_id: job.claim_id, status, message: String(message).slice(0, 300) };
      await save(state);
      await acknowledge(state);
    },
  };
}
