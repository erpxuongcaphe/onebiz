import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRpc, createProgressWatchdog } from '../public/print-point/recovery.mjs';
const config = { url: 'https://test.invalid', pointId: 'point', token: 'private-token', publicKey: 'public-key' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('stalled fetch ignoring abort expires, then the next claim can proceed', async () => {
  let calls = 0, signal, clock = 0;
  const rpc = createAgentRpc(config, async (_url, options) => {
    signal = options.signal;
    if (++calls === 1) return new Promise(() => {});
    return { ok: true, json: async () => null };
  }, 20, () => clock);
  await assert.rejects(rpc('claim'), /PRINT_RPC_TIMEOUT/);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1, 'a lost claim must not be automatically retried');
  clock = 5000;
  assert.equal(await rpc('claim'), null);
});

test('invalid receiver backs off claim and background heartbeat together, then can recover', async () => {
  let clock = 0, calls = 0;
  const rpc = createAgentRpc(config, async () => {
    calls++;
    return calls === 1 ? { ok: false, status: 401 } : { ok: true, json: async () => null };
  }, 100, () => clock);
  await assert.rejects(rpc('claim'), error => error.message === 'PRINT_RPC_HTTP_401' && error.retryAfterMs === 300000);
  for (const action of ['claim', 'heartbeat', 'finish']) {
    await assert.rejects(rpc(action), /PRINT_RPC_BACKOFF/);
  }
  assert.equal(calls, 1);
  clock = 300000;
  assert.equal(await rpc('claim'), null);
  assert.equal(calls, 2);
  assert.equal(await rpc('claim'), null, 'healthy polling is not delayed');
});

test('transient outage increases cooldown and successful response resets it', async () => {
  let clock = 0, calls = 0;
  const rpc = createAgentRpc(config, async () => {
    calls++;
    return calls === 3 ? { ok: true, json: async () => null } : { ok: false, status: 503 };
  }, 100, () => clock);
  await assert.rejects(rpc('claim'), error => error.retryAfterMs === 5000);
  clock += 5000;
  await assert.rejects(rpc('claim'), error => error.retryAfterMs === 10000);
  clock += 10000;
  assert.equal(await rpc('claim'), null);
  await assert.rejects(rpc('claim'), error => error.retryAfterMs === 5000);
});

test('rate limited receiver respects bounded Retry-After without replaying a claim', async () => {
  let calls = 0;
  const rpc = createAgentRpc(config, async () => {
    calls++;
    return { ok: false, status: 429, headers: new Headers({ 'retry-after': '120' }) };
  });
  await assert.rejects(rpc('claim'), error => error.retryAfterMs === 120000);
  await assert.rejects(rpc('claim'), /PRINT_RPC_BACKOFF/);
  assert.equal(calls, 1);
});
test('headers arrive but a stuck JSON body still expires', async () => {
  const rpc = createAgentRpc(config, async () => ({ok:true,json:()=>new Promise(()=>{})}), 20);
  await assert.rejects(rpc('claim'), /PRINT_RPC_TIMEOUT/);
});
test('a late response is discarded and cannot reach the physical sender', async () => {
  let complete, sent = 0;
  const rpc = createAgentRpc(config, async () => ({ok:true,json:()=>new Promise(resolve=>{complete=resolve;})}), 20);
  await assert.rejects(rpc('claim').then(job=>{if(job)sent++;}), /TIMEOUT/);
  complete({id:'late-job',bytes:'never-send'}); await delay(5);
  assert.equal(sent, 0);
});
test('finish ack timeout never retries or requests a physical print', async () => {
  const calls = [];
  const rpc = createAgentRpc(config, async (_url,options)=>{calls.push(JSON.parse(options.body).p_action);return new Promise(()=>{});},20);
  await assert.rejects(rpc('finish',{id:'job',status:'handed_off'}),/TIMEOUT/);
  assert.deepEqual(calls,['finish']);
});
test('HTTP errors expose no credential and JSON rejection releases the request', async () => {
  const rpc = createAgentRpc(config, async()=>({ok:false,status:403}),20);
  await assert.rejects(rpc('claim'), /^Error: PRINT_RPC_HTTP_403$/);
  const broken = createAgentRpc(config, async()=>({ok:true,json:async()=>{throw new Error('invalid JSON');}}),20);
  await assert.rejects(broken('claim'),/invalid JSON/);
});
test('watchdog notices lack of queue progress exactly once', async () => {
  let clock=0, stalls=0;
  const watchdog=createProgressWatchdog(()=>{stalls++;},10,()=>clock);
  clock=10;await delay(35);assert.equal(stalls,1);watchdog.close();
});
test('queue progress and shutdown prevent false watchdog restarts', async () => {
  let clock=0, stalls=0;
  const watchdog=createProgressWatchdog(()=>{stalls++;},15,()=>clock);
  clock=10;watchdog.pulse();await delay(20);assert.equal(stalls,0);
  watchdog.close();clock=100;await delay(20);assert.equal(stalls,0);
});

test('public ZIP includes matching recovery/supervisor files and no point credentials', async () => {
  const {readFile}=await import('node:fs/promises');const {inflateRawSync}=await import('node:zlib');
  const zip=await readFile(new URL('../public/print-point/onebiz-print-point.zip',import.meta.url));
  const entries=new Map();let offset=0;
  while(zip.readUInt32LE(offset)===0x04034b50){
    const method=zip.readUInt16LE(offset+8),size=zip.readUInt32LE(offset+18),nameLength=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28);
    const name=zip.subarray(offset+30,offset+30+nameLength).toString();const start=offset+30+nameLength+extra;
    const body=zip.subarray(start,start+size);entries.set(name,method===8?inflateRawSync(body):body);offset=start+size;
  }
  assert.equal(entries.has('onebiz-print-point.json'),false);
  assert.deepEqual(entries.get('OnebizUsbWorker.exe'),await readFile(new URL('../public/print-point/OnebizUsbWorker.exe',import.meta.url)));
  for(const name of ['agent.mjs','recovery.mjs','polling.mjs','run.ps1','usb-worker.mjs','README.txt','setup.ps1','autostart.ps1','start-hidden.vbs','update-autostart.ps1','OnebizUsbWorker.cs','update-native-usb.ps1']){
    // Git checks out LF on Linux and CRLF on Windows; compare text, not platform newlines.
    assert.equal(entries.get(name)?.toString('utf8').replace(/\r\n/g,'\n'),(await readFile(new URL('../public/print-point/'+name,import.meta.url),'utf8')).replace(/\r\n/g,'\n'));
  }
});
