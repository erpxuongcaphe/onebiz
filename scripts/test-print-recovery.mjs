import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_VERSION, createAgentRpc, createAgentRetryPolicy, createProgressWatchdog, retryAfterMilliseconds, waitForAgentRetry } from '../public/print-point/recovery.mjs';
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
  for(const name of ['agent.mjs','recovery.mjs','run.ps1','usb-worker.mjs','README.txt','diagnose.ps1']){
    // Git checks out LF on Linux and CRLF on Windows; compare text, not platform newlines.
    assert.equal(entries.get(name)?.toString('utf8').replace(/\r\n/g,'\n'),(await readFile(new URL('../public/print-point/'+name,import.meta.url),'utf8')).replace(/\r\n/g,'\n'));
  }
});

test('unauthorized configuration backs off from one minute to five, never at the old five-second cadence', () => {
  const policy=createAgentRetryPolicy(()=>0);
  assert.deepEqual(Array.from({length:6},()=>policy.failure({status:401}).delayMs),[60000,120000,240000,300000,300000,300000]);
  assert.equal(policy.failure({status:403}).code,'PRINT_CONNECTION_REJECTED_CHECK_LOCAL_CONFIG');
});
test('temporary failures back off with bounded jitter and a successful poll resets recovery', () => {
  const policy=createAgentRetryPolicy(()=>1);
  assert.equal(policy.failure({status:503}).delayMs,6000);
  assert.equal(policy.failure(new Error('network')).delayMs,12000);
  for(let i=0;i<20;i++)assert.ok(policy.failure({status:504}).delayMs<=60000);
  policy.success();assert.equal(policy.failure({status:503}).delayMs,6000);
  assert.equal(policy.failure({status:401}).delayMs,72000);
});
test('server rate-limit cooldown is honored, including HTTP-date form', async () => {
  const rpc=createAgentRpc(config,async()=>({ok:false,status:429,headers:{get:()=> '600'}}));
  let failure;try{await rpc('claim');}catch(error){failure=error;}
  assert.equal(failure.status,429);assert.equal(createAgentRetryPolicy(()=>0).failure(failure).delayMs,600000);
  assert.equal(retryAfterMilliseconds('Wed, 28 Oct 2026 12:01:00 GMT',Date.parse('2026-10-28T12:00:00Z')),60000);
  assert.equal(retryAfterMilliseconds('not-a-date'),undefined);
  assert.equal(retryAfterMilliseconds('-2'),undefined);
  assert.equal(retryAfterMilliseconds('999999'),3600000);
});
test('HTTP credentials/body never enter a retry log and the RPC itself is never retried', async () => {
  let requests=0,headers;
  const rpc=createAgentRpc(config,async(_url,options)=>{requests++;headers=options.headers;return {ok:false,status:401,json:async()=>{throw Error('private-token MUST NOT BE READ');}};});
  let failure;try{await rpc('claim');}catch(error){failure=error;}
  const retry=createAgentRetryPolicy(()=>0).failure(failure);
  assert.equal(requests,1);assert.equal(headers['User-Agent'],`OnebizPrintPoint/${AGENT_VERSION} (Node)`);
  assert.equal(JSON.stringify(retry).includes(config.token),false);
});
test('a valid point keeps its one-second empty-queue cadence and does not inherit another point cooldown', () => {
  const rejected=createAgentRetryPolicy(()=>0),valid=createAgentRetryPolicy(()=>0);
  rejected.failure({status:401});rejected.failure({status:401});
  valid.success();assert.equal(valid.failure({status:503}).delayMs,5000);
  // This policy has no idle-delay API and never changes the successful loop's sleep(1000).
  valid.success();assert.equal(valid.failure({status:503}).delayMs,5000);
});
test('intentional retry cooldown does not trigger a restart, but a subsequent real stall still does', async () => {
  let clock=0,stalls=0;
  const watchdog=createProgressWatchdog(()=>{stalls++;},20,()=>clock);
  watchdog.deferRetry(300000);clock=299999;await delay(30);assert.equal(stalls,0);
  clock=300000;watchdog.pulse();clock=300020;await delay(35);assert.equal(stalls,1);watchdog.close();
});
test('invalid watchdog deferral is rejected and cannot disable stall recovery forever', () => {
  const watchdog=createProgressWatchdog(()=>{},1000);
  for(const value of [-1,NaN,Infinity,3600001])assert.throws(()=>watchdog.deferRetry(value),/INVALID_PRINT_RETRY_DELAY/);
  watchdog.close();
});
test('retry waiting can stop promptly and performs no replay or physical send', async () => {
  let waits=0,stop=false;
  await waitForAgentRetry(300000,async ms=>{assert.equal(ms,1000);waits++;stop=true;},()=>stop);
  assert.equal(waits,1);
});
