const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.HUB_PLAYWRIGHT_DIR||'playwright');
const output=process.env.HUB_QA_OUTPUT;
if(!output)throw Error('HUB_QA_OUTPUT is required');
const base='http://127.0.0.1:3315';
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage();page.setDefaultTimeout(30000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 const results=[];
 const close=async()=>{
  const dialog=page.getByRole('dialog').filter({visible:true}).last();
  await dialog.getByRole('button',{name:/^(Đóng|Hủy)$/}).first().click();
  const discard=page.getByRole('button',{name:'Bỏ thay đổi và đóng',exact:true});if(await discard.isVisible())await discard.click();
  await dialog.waitFor({state:'hidden'});
 };
 const inspect=async(name)=>{
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: page overflow`);
  const dialog=page.getByRole('dialog').filter({visible:true}).last();
  if(await dialog.count()){
   const box=await dialog.boundingBox(),size=page.viewportSize();
   assert.ok(box&&box.x>=-1&&box.y>=-1&&box.x+box.width<=size.width+1&&box.y+box.height<=size.height+1,`${name}: dialog outside viewport`);
   assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`${name}: dialog overflow`);
  }
  await page.screenshot({path:path.join(output,name+'.png'),fullPage:!(await dialog.count())});results.push(name);console.log('PASS',name);
 };
 try{
  await page.request.post(base+'/__test__/actor',{data:{actor:'owner'}});
  for(const [width,height] of [[1920,1080],[1366,768],[1280,800],[1024,768],[390,844],[430,932]]){
   await page.request.post(base+'/__test__/actor',{data:{actor:'owner'}});
   await page.setViewportSize({width,height});await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
   await page.locator('aside').getByRole('button',{name:'Tổng quan',exact:true}).click();
   await page.getByRole('heading',{name:'Tuân thủ công việc',exact:true}).waitFor();
   await inspect(`overview-${width}`);
   await page.getByRole('button',{name:/Chờ kiểm tra lại:/}).click();
   if(width<=640){
    await page.getByRole('button',{name:/^Bộ lọc/}).click();
    await page.getByRole('dialog').filter({visible:true}).getByLabel('Trạng thái',{exact:true}).waitFor();
    assert.equal(await page.getByRole('dialog').filter({visible:true}).getByLabel('Trạng thái',{exact:true}).inputValue(),'pending_review');
    await inspect(`filters-${width}`);
    await page.getByRole('dialog').filter({visible:true}).getByLabel('Khoảng thời gian',{exact:true}).selectOption('custom');
    await page.getByRole('dialog').filter({visible:true}).getByLabel('Từ ngày',{exact:true}).waitFor();
    await inspect(`filters-custom-${width}`);
    await page.getByRole('dialog').filter({visible:true}).getByRole('button',{name:'Bỏ bộ lọc',exact:true}).click();
    await page.getByRole('button',{name:'Xem kết quả',exact:true}).click();
   }else assert.equal(await page.getByLabel('Trạng thái',{exact:true}).inputValue(),'pending_review');
   await page.locator('aside').getByRole('button',{name:'Thiết lập',exact:true}).click();
   await page.getByRole('heading',{name:'Công việc và quyền chi nhánh',exact:true}).waitFor();
   await inspect(`settings-${width}`);
   await page.getByRole('button',{name:'Thêm kỳ đánh giá',exact:true}).click();
   await page.getByLabel('Tên kỳ đánh giá',{exact:true}).waitFor();
   await inspect(`period-${width}`);await close();
   await page.getByRole('button',{name:'Thêm nhóm QC',exact:true}).click();
   await page.getByLabel('Tên nhóm tiêu chuẩn',{exact:true}).waitFor();
   await inspect(`group-${width}`);await close();
   await page.getByRole('button',{name:'Chính sách mới',exact:true}).click();
   await page.getByLabel('Lỗi chưa khắc phục qua kỳ mới',{exact:true}).waitFor();
   const policy=page.getByRole('dialog').filter({visible:true});
   await policy.getByLabel('Áp dụng sàn điểm',{exact:true}).uncheck();
   assert.equal(await policy.getByLabel('Sàn điểm',{exact:true}).isDisabled(),true);
   await policy.getByLabel('Áp dụng sàn điểm',{exact:true}).check();
   await inspect(`rule-${width}`);await close();
   await page.locator('aside').getByRole('button',{name:'KPI & thưởng',exact:true}).click();
   await page.getByRole('button',{name:'Thiết lập chỉ tiêu',exact:true}).waitFor();
   await page.getByRole('button',{name:'Thiết lập chỉ tiêu',exact:true}).click();
   await page.getByLabel('Chỉ tiêu doanh thu (đồng)',{exact:true}).waitFor();
   await inspect(`revenue-${width}`);await close();
   await page.request.post(base+'/__test__/actor',{data:{actor:'manager'}});
   await page.goto(base,{waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:'Tự kiểm tra phát sinh',exact:true}).click();
   const dialog=page.getByRole('dialog').filter({visible:true});
   await dialog.getByLabel('Công việc được kiểm tra',{exact:true}).selectOption({index:1});
   await inspect(`adhoc-${width}`);
   await dialog.locator('textarea[name="note"]').fill('Giữ nội dung khi vô tình đóng');
   await dialog.getByRole('button',{name:'Hủy',exact:true}).click();
   await page.getByRole('button',{name:'Quay lại để lưu',exact:true}).click();
   assert.equal(await dialog.locator('textarea[name="note"]').inputValue(),'Giữ nội dung khi vô tình đóng');
   results.push(`adhoc-keep-unsaved-${width}`);await close();
   await page.getByRole('button',{name:'Phát sinh ngoài lịch',exact:true}).click();
   await inspect(`adhoc-history-${width}`);
  }
  assert.deepEqual(errors,[],'Browser runtime errors');
  fs.writeFileSync(path.join(output,'complete-browser-results.json'),JSON.stringify({passed:results.length,results,errors},null,2));
  console.log(`PASS ${results.length} complete Hub page and popup checks`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
