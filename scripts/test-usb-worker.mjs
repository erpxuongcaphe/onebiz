import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createUsbWorker, printFailureStatus } from '../public/print-point/usb-worker.mjs';

function fixture(timeout = 1000) {
  const children = [];
  const worker = createUsbWorker('spool.ps1', () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.writes = [];
    child.stdin = { write(line, callback) { child.writes.push(JSON.parse(line)); callback?.(); } };
    child.kill = () => { queueMicrotask(() => child.emit('close', 0)); };
    children.push(child);
    queueMicrotask(() => child.stdout.write('{"ready":true}\n'));
    return child;
  }, timeout);
  return { worker, children };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('warms once and reuses one process for sequential USB jobs', async () => {
  const { worker, children } = fixture();
  await worker.warm();
  for (const name of ['first.bin', 'second.bin']) {
    const sent = worker.send(name, 'XP-80'); await tick();
    children[0].stdout.write('{"status":"handed_off"}\n');
    assert.equal((await sent).status, 'handed_off');
  }
  assert.equal(children.length, 1);
  assert.equal(children[0].writes.length, 2);
  worker.close();
});
test('does not dispatch a concurrent send', async () => {
  const { worker, children } = fixture();
  const first = worker.send('first.bin', 'XP-80'); await tick();
  await assert.rejects(worker.send('second.bin', 'XP-80'), /BUSY/);
  assert.equal(children[0].writes.length, 1);
  children[0].stdout.write('{"status":"unknown"}\n');
  assert.equal((await first).status, 'unknown'); worker.close();
});
test('lost response is rejected and never replays the bill', async () => {
  const { worker, children } = fixture();
  const first = worker.send('first.bin', 'XP-80');
  const rejected = assert.rejects(first, /DISCONNECTED/); await tick();
  children[0].emit('close', 1); await rejected;
  assert.equal(children.length, 1); assert.equal(children[0].writes.length, 1);
  const next = worker.send('next.bin', 'XP-80'); await tick();
  assert.equal(children.length, 2);
  assert.deepEqual(children[1].writes, [{ file: 'next.bin', printer: 'XP-80' }]);
  children[1].stdout.write('{"status":"handed_off"}\n'); await next; worker.close();
});
test('timeout never retries the physical send', async () => {
  const { worker, children } = fixture(30);
  await assert.rejects(worker.send('first.bin', 'XP-80'), /TIMEOUT/);
  assert.equal(children.length, 1); assert.equal(children[0].writes.length, 1); worker.close();
});
test('invalid result is rejected, not considered printed', async () => {
  const { worker, children } = fixture();
  const sent = worker.send('first.bin', 'XP-80');
  const rejected = assert.rejects(sent, /INVALID_RESPONSE/); await tick();
  children[0].stdout.write('{"status":"printed"}\n'); await rejected; worker.close();
});
test('closed worker cannot restart or send another bill', async () => {
  const { worker, children } = fixture(); worker.close();
  await assert.rejects(worker.send('first.bin', 'XP-80'), /STOPPED/);
  assert.equal(children.length, 0);
});

test('native worker is used directly without launching PowerShell', async () => {
  let launch;
  const worker=createUsbWorker('spool.ps1',(file,args)=>{
    launch={file,args};const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=()=>{};child.stdin={write(){}};queueMicrotask(()=>child.stdout.write('{"ready":true}\n'));return child;
  },1000,'C:\\Onebiz\\OnebizUsbWorker.exe');
  await worker.warm();assert.deepEqual(launch,{file:'C:\\Onebiz\\OnebizUsbWorker.exe',args:[]});worker.close();
});

test('startup timeout writes no request and a fresh worker can recover', async () => {
  let starts=0,writes=0;
  const worker=createUsbWorker('spool.ps1',()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    child.stdin={write(){writes++;}};starts++;
    if(starts===2)queueMicrotask(()=>child.stdout.write('{"ready":true}\n'));return child;
  },20,'native.exe');
  await assert.rejects(worker.send('first.bin','XP-80'),e=>e.message==='USB_WORKER_START_TIMEOUT' && e.printAttempted===false && printFailureStatus(e,true)==='failed');
  assert.equal(writes,0);await worker.warm();assert.equal(starts,2);assert.equal(writes,0);worker.close();
});

test('lost dispatch remains uncertain while startup failures are safe, without replay',()=>{
  assert.equal(printFailureStatus({printAttempted:true},true),'unknown');
  assert.equal(printFailureStatus({},true),'unknown');
  assert.equal(printFailureStatus({printAttempted:false},true),'failed');
  assert.equal(printFailureStatus({},false),'failed');
});

test('closing during startup rejects its waiter instead of leaving it stuck', async () => {
  const worker=createUsbWorker('spool.ps1',()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};return child;},1000);
  const ready=worker.warm();const rejected=assert.rejects(ready,/STOPPED/);worker.close();await rejected;
});

test('synchronous spawn failure is safe and does not poison later warm attempts', async () => {
  let starts=0;const worker=createUsbWorker('spool.ps1',()=>{starts++;throw new Error('SPAWN_DENIED');},1000,'native.exe');
  for(let i=0;i<2;i++) await assert.rejects(worker.send('fixture','XP'),e=>e.message==='SPAWN_DENIED'&&e.printAttempted===false);
  assert.equal(starts,2);worker.close();
});
