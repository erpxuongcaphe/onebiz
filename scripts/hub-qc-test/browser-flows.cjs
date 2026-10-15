const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {chromium}=require(process.env.HUB_PLAYWRIGHT_DIR||'playwright');
const out=process.env.HUB_QA_OUTPUT||path.resolve(__dirname,'../../../hub-qc-browser-output');
const base='http://127.0.0.1:3315';
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768}});page.setDefaultTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let checks=0;
await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
const actor=async who=>{await page.request.post(base+'/__test__/actor',{data:{actor:who}});await page.goto(base,{waitUntil:'domcontentloaded',timeout:120000});};
const nav=async name=>{await page.locator('aside').getByRole('button',{name,exact:true}).click();await page.waitForTimeout(350);};
const dialog=()=>page.getByRole('dialog').filter({visible:true}).first();
const noDialog=async()=>{await page.getByRole('dialog').waitFor({state:'hidden'});checks++;};
const row=title=>page.getByRole('row').filter({hasText:title}).or(page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})})).filter({visible:true}).first();
try{
await actor('owner');await nav('Thiết lập');await page.getByRole('button',{name:'Chính sách mới',exact:true}).click();let d=dialog();await d.getByLabel('Tên phiên bản chính sách',{exact:true}).fill('Bản nháp giữ nội dung');
const box=await d.boundingBox();assert.ok(box.width>1200);checks++;
await page.mouse.click(1,1);assert.equal(await d.getByLabel('Tên phiên bản chính sách',{exact:true}).inputValue(),'Bản nháp giữ nội dung');checks++;
await page.keyboard.press('Escape');await page.getByRole('button',{name:'Quay lại để lưu',exact:true}).click();assert.equal(await d.getByLabel('Tên phiên bản chính sách',{exact:true}).inputValue(),'Bản nháp giữ nội dung');checks++;
await page.screenshot({path:path.join(out,'desktop-policy-dialog.png'),fullPage:true});
await d.getByRole('button',{name:'Hủy',exact:true}).click();await page.getByRole('button',{name:'Bỏ thay đổi và đóng',exact:true}).click();await noDialog();
for(const [width,height] of [[1366,768],[390,844]]){
 await page.setViewportSize({width,height});await actor('manager');await page.getByRole('button',{name:'Ghi kết quả',exact:true}).first().click();d=dialog();
 await d.getByLabel('Lần 1',{exact:true}).selectOption('0');await d.getByLabel('Minh chứng lần 1 *',{exact:true}).fill('Kết quả kiểm tra trình duyệt');
 await d.getByRole('checkbox',{name:/Lo B/}).check();await d.getByRole('button',{name:'Lưu',exact:true}).click();await noDialog();
 await nav('To-do');await page.getByRole('button',{name:'To-do',exact:true}).last().click();d=dialog();const title=`Kiểm thử Hub ${width}`;
 await d.getByLabel('Nội dung cần xử lý',{exact:true}).fill(title);await d.getByLabel('Mô tả vấn đề / lô hàng / thiết bị',{exact:true}).fill('Dữ liệu giả của kiểm thử, không phải công việc thật');await d.getByLabel('Deadline (giờ Việt Nam)',{exact:true}).fill('2026-10-30T17:00');
 await d.getByLabel('Bộ phận phối hợp (không bắt buộc)',{exact:true}).selectOption({label:'Bao tri'});await d.getByLabel('Người xử lý (có thể nhận việc sau)',{exact:true}).selectOption({label:'operator'});
 await page.screenshot({path:path.join(out,`${width}-issue-dialog.png`),fullPage:false});
 assert.equal(await d.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);checks++;
 await d.getByRole('button',{name:'Lưu',exact:true}).click();await noDialog();await page.getByRole('searchbox',{name:'Tìm công việc / vấn đề'}).fill(title);await page.waitForTimeout(500);await row(title).waitFor();checks++;
 await actor('operator');await page.getByRole('heading',{name:'To-do & phối hợp',exact:true}).waitFor();await row(title).getByRole('button',{name:'Nhận việc',exact:true}).click();d=dialog();await d.getByLabel('Trạng thái tiếp theo',{exact:true}).selectOption('in_progress');await d.getByRole('button',{name:'Lưu',exact:true}).click();await noDialog();
 await row(title).getByRole('button',{name:'Báo đã xử lý',exact:true}).click();d=dialog();await d.getByLabel('Trạng thái tiếp theo',{exact:true}).selectOption('pending_review');await d.getByLabel('Kết quả khắc phục',{exact:true}).fill('Đã xử lý và chờ quản lý kiểm tra');await d.getByRole('button',{name:'Lưu',exact:true}).click();await noDialog();
 assert.equal(await row(title).getByRole('button',{name:'Kiểm tra lại',exact:true}).count(),0);checks++;
 await actor('manager');await nav('To-do');await row(title).getByRole('button',{name:'Kiểm tra lại',exact:true}).click();d=dialog();await d.getByLabel('Kết quả tại quán',{exact:true}).selectOption('met');await d.getByLabel('Kết quả kiểm tra lại',{exact:true}).fill('Đạt sau khắc phục, xác nhận tại quán');await d.getByRole('button',{name:'Lưu',exact:true}).click();await noDialog();
 assert.ok((await row(title).innerText()).includes('Đã đóng'));checks++;
 await page.screenshot({path:path.join(out,`${width}-workflow-completed.png`),fullPage:true});
}
assert.deepEqual(errors,[]);checks++;console.log(`PASS ${checks} browser workflow/guard/permission assertions`,out);
}catch(e){console.log('FAILED_BODY',await page.locator('body').innerText());await page.screenshot({path:path.join(out,'flow-failed.png'),fullPage:true});throw e;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
