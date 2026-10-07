import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDestination, isConnectionProbe } from './destination.mjs';
import { sendNetworkPrint } from './network.mjs';

export function validateRaster(bytes, paper) {
  if (!['58mm', '80mm'].includes(paper) || bytes.length > 1800000) throw new Error('INVALID_RASTER');
  if (![0x1b,0x40,0x1b,0x61,1].every((n,i)=>bytes[i]===n)) throw new Error('INVALID_RASTER');
  let offset=5, rows=0;
  const stride=paper==='58mm'?48:72;
  while(offset+8<=bytes.length && bytes[offset]===0x1d && bytes[offset+1]===0x76) {
    const width=bytes[offset+4]+256*bytes[offset+5], height=bytes[offset+6]+256*bytes[offset+7];
    if(bytes[offset+2]!==0x30 || bytes[offset+3]!==0 || width!==stride || height<1 || height>256) throw new Error('INVALID_RASTER');
    offset+=8+width*height; rows+=height;
    if(offset>bytes.length || rows>24000) throw new Error('INVALID_RASTER');
  }
  if(!rows || bytes.length-offset!==6 || ![0x1b,0x64,3,0x1d,0x56,1].every((n,i)=>bytes[offset+i]===n)) throw new Error('INVALID_RASTER');
}

export async function runAgent(configPath) {
  if(process.platform!=='win32') throw new Error('Điểm in này hiện hỗ trợ Windows.');
  const config=JSON.parse(await readFile(configPath,'utf8')), url=new URL(config.url);
  if(url.protocol!=='https:' || !/^[0-9a-f-]{36}$/.test(config.pointId) || !/^[0-9a-f]{64}$/.test(config.token) || !config.publicKey) throw new Error('Tệp cấu hình không hợp lệ.');
  const call=async(action,data={})=>{
    const response=await fetch(new URL('/rest/v1/rpc/fnb_print_agent_v1',url),{method:'POST',headers:{'Content-Type':'application/json',apikey:config.publicKey},body:JSON.stringify({p_point:config.pointId,p_token:config.token,p_action:action,p_data:data}),signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error(`Điểm in chưa kết nối được (${response.status}). Kiểm tra mạng hoặc cấp lại mã kết nối.`);
    return response.json();
  };
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const discover=()=>new Promise(done=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name) | ConvertTo-Json -Compress'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let out='';child.stdout.on('data',b=>{out+=b.toString();});child.stderr.on('data',()=>{});
    const timer=setTimeout(()=>{child.kill();done([]);},10000);
    child.on('error',()=>{clearTimeout(timer);done([]);});
    child.on('close',()=>{clearTimeout(timer);try{const names=JSON.parse(out||'[]');done((Array.isArray(names)?names:[names]).filter(n=>typeof n==='string').slice(0,100));}catch{done([]);}});
  });
  let lastDiscovery=0;
  let stopped=false;
  process.on('SIGINT',()=>{stopped=true;}); process.on('SIGTERM',()=>{stopped=true;});
  console.log('Onebiz · Điểm in đang chạy. Giữ máy bật.');
  while(!stopped) {
    try {
      if(Date.now()-lastDiscovery>300000){await call('heartbeat',{printers:await discover()});lastDiscovery=Date.now();}
      const job=await call('claim');
      if(!job){await sleep(2500);continue;}
      let status='failed',message='Không dựng được dữ liệu in.',attempted=false,tempPath;
      try {
        const bytes=Buffer.from(job.bytes,'base64');
        const probe = isConnectionProbe(bytes);
        if (!probe) validateRaster(bytes,job.paper);
        const destination = parseDestination(job.printer);
        const payload=job.label.startsWith('IN LẠI')?Buffer.concat([Buffer.from('\x1b@IN LAI - KIEM TRA TRUNG MON\n','ascii'),bytes]):bytes;
        if (destination.type === 'tcp') {
          const result = await sendNetworkPrint(job.printer, probe ? null : payload);
          status = result.status; message = result.message;
        } else if (probe) {
          const names = await discover();
          status = names.includes(destination.printer) ? 'handed_off' : 'failed';
          message = status === 'handed_off' ? 'Windows có máy in này. Chưa xác nhận USB đang cắm hoặc giấy đã sẵn sàng; dùng In thử để kiểm tra.' : 'Không tìm thấy tên máy trong Windows. Cài driver, kiểm tra tên và bấm Cập nhật.';
        } else {
        tempPath=join(tmpdir(),`onebiz-print-${randomUUID()}.bin`);
        await writeFile(tempPath,payload,{flag:'wx'}); attempted=true;
        const output=await new Promise((done,reject)=>{
          const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',join(dirname(fileURLToPath(import.meta.url)),'spool.ps1')],{windowsHide:true,env:{...process.env,ONEBIZ_PRINT_FILE:tempPath,ONEBIZ_PRINT_PRINTER:job.printer},stdio:['ignore','pipe','pipe']});
          let out=''; child.stdout.on('data',b=>{out+=b.toString();}); child.stderr.on('data',()=>{});
          const timer=setTimeout(()=>{child.kill();reject(new Error('Điểm in quá thời gian; kiểm tra giấy trước khi in lại.'));},45000);
          child.on('error',e=>{clearTimeout(timer);reject(e);});
          child.on('close',code=>{clearTimeout(timer);code===0?done(out.trim()):reject(new Error('Chưa xác nhận kết quả gửi máy. Kiểm tra hàng đợi Windows và giấy.'));});
        });
        const result=JSON.parse(output); status=result.status;
        message=status==='handed_off'?'Windows đã nhận lệnh. Kiểm tra giấy tại máy; chưa xác nhận giấy đã ra.':status==='failed'?'Windows chưa nhận lệnh. Kiểm tra tên máy, driver và quyền dùng máy in.':'Chưa xác nhận đủ dữ liệu gửi. Kiểm tra giấy trước khi in lại.';
        if(!['handed_off','failed','unknown'].includes(status)) throw new Error('Kết quả điểm in không hợp lệ.');
        }
      }catch(error){status=attempted?'unknown':'failed';message=error.message;}
      finally{if(tempPath)await unlink(tempPath).catch(()=>{});}
      // Retry acknowledgement only. Never repeat the physical send.
      for(let attempt=0;attempt<3;attempt++){
        try{await call('finish',{id:job.id,claim_id:job.claim_id,status,message});break;}
        catch(error){console.error(error.message);await sleep(2500);}
      }
      console.log(`${job.id} · ${status}`);
    }catch(error){console.error(error.message);await sleep(5000);}
  }
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  runAgent(resolve(process.argv[2]||'onebiz-print-point.json')).catch(error=>{console.error(error.message);process.exitCode=1;});
}
