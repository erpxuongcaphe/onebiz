const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.HUB_PLAYWRIGHT_DIR||'playwright');
const base='http://127.0.0.1:3315',out=process.env.HUB_QA_OUTPUT,results=[];
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(30000);
 const consoleErrors=[];page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text()+' '+m.location().url);});
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const test=async(id,fn)=>{try{await fn();results.push({id,pass:true});console.log('PASS',id);}catch(e){results.push({id,pass:false,error:e.message});console.log('FAIL',id,e.message);await page.screenshot({path:path.join(out,id+'-failed.png')});}};
 const actor=async who=>{await page.request.post(base+'/__test__/actor',{data:{actor:who}});await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});await page.locator('aside').waitFor();};
 const nav=async name=>{await page.locator('aside').getByRole('button',{name,exact:true}).click();await page.waitForTimeout(300);};
 const d=()=>page.getByRole('dialog').filter({visible:true}).first();
 const close=async()=>{await d().getByRole('button',{name:/^(Hủy|Đóng)$/}).first().click();const discard=page.getByRole('button',{name:'Bỏ thay đổi và đóng',exact:true});if(await discard.isVisible())await discard.click();await page.getByRole('dialog').waitFor({state:'hidden'});};
 try{
  await actor('owner');await nav('Thiết lập');await page.getByRole('button',{name:'Chính sách mới',exact:true}).click();
  await d().getByLabel('Sàn điểm',{exact:true}).fill('0');await d().getByLabel('Trần điểm',{exact:true}).fill('120');await d().getByLabel('Tổng điểm cộng tối đa mỗi kỳ',{exact:true}).fill('10');
  await d().getByLabel('Lỗi lặp trong kỳ',{exact:true}).selectOption('each_audit');await d().getByLabel('Xét điểm tối thiểu',{exact:true}).selectOption('after_bonus');await d().getByLabel('Cho điểm/thưởng vượt 100',{exact:true}).selectOption('true');
  await test('rule-warning-reacts-to-current-selections',async()=>{assert.equal(await d().getByText(/Chưa chọn quy tắc lỗi lặp|Chưa chọn cách xét ngưỡng thưởng|Chưa chọn chương trình vượt 100/).count(),0);});
  await close();await nav('To-do');
  await test('date-filter-has-no-ambiguous-empty-choice',async()=>{await page.getByRole('button',{name:/^Bộ lọc/}).click();const options=await page.getByLabel('Khoảng thời gian',{exact:true}).locator('option').allTextContents();assert.equal(options.filter(t=>t==='Tất cả').length,0);await page.getByRole('button',{name:'Xem kết quả',exact:true}).click();});
  await test('ledger-link-retains-branch-and-period',async()=>{await nav('KPI & thưởng');const href=await page.locator('a[href*="view=qc"]').first().getAttribute('href');const url=new URL(href,base);assert.equal(url.searchParams.get('branch'),'20000000-0000-4000-8000-000000000001');assert.ok(url.searchParams.get('period'));assert.ok(url.searchParams.get('audit'));});
  await test('qc-line-real-editor-mobile',async()=>{
   await actor('qc');await nav('QC độc lập');await page.getByRole('button',{name:'Tạo đợt QC',exact:true}).click();
   const title='Đợt QC nghiệm thu popup '+Date.now();await d().getByLabel('Tên đợt kiểm tra',{exact:true}).fill(title);await d().getByRole('button',{name:'Lưu',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
   await page.locator('article').filter({hasText:title}).getByRole('button',{name:'Mở đợt',exact:true}).click();await page.getByRole('button',{name:'Ghi kết quả',exact:true}).filter({visible:true}).first().click();
   assert.ok(await d().getByRole('button',{name:'Lưu',exact:true}).isVisible());
   await page.setViewportSize({width:390,height:480});await page.waitForTimeout(250);const b=await d().boundingBox();assert.ok(b.height<=481&&b.y>=-1,JSON.stringify(b));
   await d().getByRole('button',{name:'Lưu',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'qc-line-small-height.png')});await close();await page.setViewportSize({width:390,height:844});
  });
  await test('browser-back-keep-unsaved-editor',async()=>{
   await actor('owner');await nav('Thiết lập');
   await page.evaluate(()=>{history.replaceState({},'', '/?qa=before');history.pushState({},'', '/?qa=editing');});
   await page.getByRole('button',{name:'Chính sách mới',exact:true}).click();await d().getByLabel('Tên phiên bản chính sách',{exact:true}).fill('Nội dung phải còn sau Back');
   await page.goBack({waitUntil:'commit'});await page.getByRole('button',{name:'Quay lại để lưu',exact:true}).click();
   assert.equal(await d().getByLabel('Tên phiên bản chính sách',{exact:true}).inputValue(),'Nội dung phải còn sau Back');await close();
  });
  await test('issue-detail-mkt-has-no-nested-form',async()=>{
   await actor('manager');await nav('To-do');await page.getByRole('button',{name:'Chi tiết',exact:true}).filter({visible:true}).first().click();
   assert.equal(await d().locator('form form').count(),0);
   assert.deepEqual(consoleErrors,[]);await close();
  });
  await test('unified-config-api-routes-available',async()=>{
   await actor('owner');await nav('Thiết lập');await page.getByRole('heading',{name:'Công việc và quyền chi nhánh',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Mẫu công việc và quyền Hub',exact:true}).count(),0);await nav('KPI & thưởng');await page.getByRole('button',{name:'Thiết lập chỉ tiêu',exact:true}).waitFor();assert.deepEqual(consoleErrors,[]);
  });
 }finally{fs.writeFileSync(path.join(out,'browser-regressions.json'),JSON.stringify(results,null,2));await browser.close();}
 if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
