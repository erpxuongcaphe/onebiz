// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const fake = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn(), spawn: vi.fn(), close: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(async () => JSON.stringify({url:'https://test.invalid',pointId:'11111111-1111-1111-1111-111111111111',token:'a'.repeat(64),publicKey:'fake'})),writeFile:vi.fn(),unlink:vi.fn() }));
vi.mock('node:child_process', () => ({spawn:fake.spawn}));
vi.mock('../../public/print-point/network.mjs', () => ({sendNetworkPrint:fake.send}));
vi.mock('../../public/print-point/usb-worker.mjs', () => ({createUsbWorker:()=>({warm:async()=>{},close:fake.close,send:vi.fn()})}));
vi.mock('../../public/print-point/recovery.mjs', async importOriginal => ({...await importOriginal<object>(),createAgentRpc:()=>fake.rpc}));
// JS package deliberately ships independently from the application TypeScript bundle.
import { runAgent } from '../../public/print-point/agent.mjs';

let stop: () => void;
let platform: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.useFakeTimers();vi.setSystemTime(0);vi.clearAllMocks();
  platform=Object.getOwnPropertyDescriptor(process,'platform');Object.defineProperty(process,'platform',{value:'win32',configurable:true});
  const original=process.on.bind(process);
  vi.spyOn(process,'on').mockImplementation(((event: string,handler:()=>void)=>{if(event==='SIGTERM'||event==='SIGINT'){stop=handler;return process;}return original(event,handler);}) as typeof process.on);
  vi.spyOn(process,'exit').mockImplementation(()=>{throw Error('UNEXPECTED_WATCHDOG_EXIT');});
  vi.spyOn(console,'log').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});vi.spyOn(Math,'random').mockReturnValue(0);
  fake.spawn.mockImplementation(()=>{const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn()});queueMicrotask(()=>child.emit('close'));return child;});
  fake.send.mockResolvedValue({status:'handed_off',message:'mock transport only'});
});
afterEach(()=>{vi.restoreAllMocks();if(platform)Object.defineProperty(process,'platform',platform);vi.useRealTimers();});
const claims=()=>fake.rpc.mock.calls.filter(([action])=>action==='claim').length;

test('actual empty queue retains one-second cadence',async()=>{
  fake.rpc.mockResolvedValue(null);const running=runAgent('fake.json');await vi.advanceTimersByTimeAsync(0);
  expect(claims()).toBe(1);await vi.advanceTimersByTimeAsync(999);expect(claims()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);expect(claims()).toBe(2);
  stop();await vi.advanceTimersByTimeAsync(1000);await running;expect(fake.send).not.toHaveBeenCalled();
});

test('rejected claim waits 60/120/240 seconds without discovery or supervisor restart',async()=>{
  fake.rpc.mockRejectedValue(Object.assign(Error('denied'),{status:401}));const running=runAgent('fake.json');await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(59999);expect(claims()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);expect(claims()).toBe(2);
  await vi.advanceTimersByTimeAsync(120000);expect(claims()).toBe(3);
  await vi.advanceTimersByTimeAsync(240000);expect(claims()).toBe(4);
  expect(fake.spawn).not.toHaveBeenCalled();expect(process.exit).not.toHaveBeenCalled();
  stop();await vi.advanceTimersByTimeAsync(1000);await running;
});

test('recovery and lost finish acknowledgements never repeat the physical send',async()=>{
  const bytes=Buffer.concat([Buffer.from([27,64,27,97,1,29,118,48,0,48,0,1,0]),Buffer.alloc(48),Buffer.from([27,100,3,29,86,1])]);
  let claimed=0,finishes=0;
  fake.rpc.mockImplementation(async(action:string)=>{
    if(action==='heartbeat')return null;
    if(action==='finish'){finishes++;throw Error('lost acknowledgement');}
    if(++claimed===1)throw Object.assign(Error('network'),{status:503});
    if(claimed===2)return {id:'fake-job',claim_id:'fake-claim',bytes:bytes.toString('base64'),paper:'58mm',printer:'tcp://192.168.1.99:9100',label:'fixture'};
    stop();return null;
  });
  const running=runAgent('fake.json');await vi.advanceTimersByTimeAsync(14000);await running;
  expect(finishes).toBe(3);expect(fake.send).toHaveBeenCalledTimes(1);expect(fake.close).toHaveBeenCalledTimes(1);
});

test('a burst of fifty LAN jobs reaches the mock transport exactly once per job',async()=>{
  const bytes=Buffer.concat([Buffer.from([27,64,27,97,1,29,118,48,0,48,0,1,0]),Buffer.alloc(48),Buffer.from([27,100,3,29,86,1])]);
  const finished:string[]=[];let count=0;
  fake.rpc.mockImplementation(async(action:string,data:{id:string})=>{
    if(action==='finish'){finished.push(data.id);return null;}
    if(action==='heartbeat')return null;
    if(++count>50){stop();return null;}
    return {id:`fixture-${count}`,claim_id:`claim-${count}`,bytes:bytes.toString('base64'),paper:'58mm',printer:'tcp://192.168.1.99:9100',label:'fixture'};
  });
  const running=runAgent('fake.json');await vi.advanceTimersByTimeAsync(1000);await running;
  expect(fake.send).toHaveBeenCalledTimes(50);expect(finished).toHaveLength(50);expect(new Set(finished).size).toBe(50);
});
