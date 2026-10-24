import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRpc, createProgressWatchdog } from '../public/print-point/recovery.mjs';
const config = { url: 'https://test.invalid', pointId: 'point', token: 'private-token', publicKey: 'public-key' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('stalled fetch ignoring abort expires, then the next claim can proceed', async () => {
  let calls = 0, signal;
  const rpc = createAgentRpc(config, async (_url, options) => {
    signal = options.signal;
    if (++calls === 1) return new Promise(() => {});
    return { ok: true, json: async () => null };
  }, 20);
  await assert.rejects(rpc('claim'), /PRINT_RPC_TIMEOUT/);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1, 'a lost claim must not be automatically retried');
  assert.equal(await rpc('claim'), null);
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
  for(const name of ['agent.mjs','recovery.mjs','run.ps1','usb-worker.mjs','README.txt']){
    assert.deepEqual(entries.get(name),await readFile(new URL('../public/print-point/'+name,import.meta.url)));
  }
});
