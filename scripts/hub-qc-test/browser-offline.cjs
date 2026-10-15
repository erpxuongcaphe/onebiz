const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.HUB_PLAYWRIGHT_DIR||'playwright');
const base='http://127.0.0.1:3315';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(30000);
 const checks=[];const ok=(condition,label)=>{assert.ok(condition,label);checks.push(label);console.log('PASS',label);};
 try{
  await page.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await page.request.post(base+'/__test__/actor',{data:{actor:'owner'}});await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('aside').getByRole('button',{name:'KPI & thưởng',exact:true}).click();
  await page.getByRole('button',{name:'Thiết lập chỉ tiêu',exact:true}).click();
  const dialog=()=>page.getByRole('dialog').filter({visible:true}).first();
  await dialog().getByLabel('Chỉ tiêu doanh thu (đồng)',{exact:true}).fill('1,000');
  await dialog().getByLabel('Nguồn doanh thu',{exact:true}).selectOption('external');
  await dialog().getByLabel('Định nghĩa doanh thu',{exact:true}).fill('Offline retry matched revenue');
  await dialog().getByLabel('Lý do thiết lập hoặc thay đổi',{exact:true}).fill('Synthetic offline acceptance');
  await dialog().getByRole('button',{name:'Lưu chỉ tiêu',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Nhập doanh thu ngoài OneBiz',exact:true}).click();
  const source='Offline synthetic '+Date.now();
  await dialog().getByLabel('Doanh thu (đồng)',{exact:true}).fill('123.45');
  await dialog().getByLabel('Tên nguồn báo cáo',{exact:true}).fill(source);
  await dialog().getByLabel('Chứng từ đối chiếu',{exact:true}).fill('Local file proof');
  const sent=[];
  await page.route('**/api/operations/quality',async route=>{
   const request=route.request();if(request.method()!=='POST')return route.continue();
   const body=request.postDataJSON();if(body.action!=='revenue')return route.continue();
   sent.push(body);
   if(sent.length===1){const response=await route.fetch();assert.equal(response.status(),200);return route.abort('failed');}
   return route.continue();
  });
  await dialog().getByRole('button',{name:'Gửi số liệu để duyệt',exact:true}).click();
  await dialog().getByRole('alert').waitFor();
  ok(await dialog().getByLabel('Tên nguồn báo cáo',{exact:true}).inputValue()===source,'Lost response keeps the full revenue form visible');
  await dialog().getByRole('button',{name:'Gửi số liệu để duyệt',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  ok(sent.length===2 && sent[0].requestId===sent[1].requestId && sent[0].payload.sourceKey===sent[1].payload.sourceKey,'Retry retains request identity and source key after a successful commit with lost response');
  const branch='20000000-0000-4000-8000-000000000001';
  const month=await page.locator('input[type="month"]').inputValue();
  const report=await (await page.request.get(base+'/api/operations/quality?'+new URLSearchParams({branch,period:month,kind:'report'}))).json();
  ok(report.revenues.filter(row=>row.source_name===source).length===1,'Successful retry creates exactly one revenue record');
  if(process.env.HUB_QA_OUTPUT){fs.mkdirSync(process.env.HUB_QA_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.HUB_QA_OUTPUT,'offline-results.json'),JSON.stringify({checks},null,2));}
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
