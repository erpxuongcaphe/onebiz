import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createUsbWorker} from '../public/print-point/usb-worker.mjs';
const warmStarted=Date.now();const worker=createUsbWorker('unused.ps1',undefined,10000,resolve(process.argv[2]));
await worker.warm();worker.close();console.log('PASS actual Node -> native warm; '+(Date.now()-warmStarted)+'ms; no PowerShell or physical send.');
const child=spawn(resolve(process.argv[2]),[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
const timer=setTimeout(()=>{child.kill();throw Error('native protocol stalled');},10000);
const lines=createInterface({input:child.stdout});let ready=false,results=0;
child.on('error',error=>{throw error;});
for await(const line of lines){const result=JSON.parse(line);if(!ready){assert.equal(result.ready,true);ready=true;
  // Invalid input reaches no printer API, even if a physical printer exists.
  child.stdin.end('invalid json\n'+JSON.stringify({file:'',printer:'Fixture'})+'\n');
}else{assert.equal(result.status,'failed');assert.equal(result.message,'INVALID_REQUEST_OR_FILE');results++;}}
const code=await new Promise(done=>{if(child.exitCode!==null)done(child.exitCode);else child.once('close',done);});
clearTimeout(timer);assert.equal(code,0);assert.equal(results,2);
console.log('PASS shipped native worker: UTF-8 ready, sequential invalid requests rejected, clean stdin EOF. No physical print.');
