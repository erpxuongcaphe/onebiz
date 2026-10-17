const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.HUB_PLAYWRIGHT_DIR || 'playwright');
const out = process.env.HUB_QA_OUTPUT;
if (!out) throw Error('HUB_QA_OUTPUT is required');
const base = 'http://127.0.0.1:3315';
const results = [];
(async () => {
  fs.mkdirSync(out, {recursive:true});
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
  const page = await browser.newPage({viewport:{width:1366,height:768}});
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if(m.type()==='error'&&!m.text().includes('503'))errors.push(m.text()); });
  await page.route('**/*', r => ['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort());
  const test = async (id, fn) => {
    try {const detail = await fn(); results.push({id,pass:true,detail}); console.log('PASS',id);}
    catch(e) {results.push({id,pass:false,error:e.message}); console.log('FAIL',id,e.message); await page.screenshot({path:path.join(out,id.replace(/[^a-z0-9-]/gi,'-')+'-FAILED.png'),fullPage:true});try{await close();}catch{}}
  };
  const actor = async name => {await page.request.post(base+'/__test__/actor',{data:{actor:name}}); await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000}); await page.locator('aside').waitFor();};
  const nav = async label => {await page.locator('aside').getByRole('button',{name:label,exact:true}).click(); await page.waitForTimeout(350);};
  const dialog = () => page.getByRole('dialog').filter({visible:true}).first();
  const close = async () => {
    const d = dialog();
    if (!await d.count()) return;
    await d.getByRole('button',{name:/^(Hủy|Đóng)$/}).first().click();
    const discard = page.getByRole('button',{name:'Bỏ thay đổi và đóng',exact:true});
    if (await discard.isVisible()) await discard.click();
    await d.waitFor({state:'hidden'});
  };
  const inspect = async (id, d = null) => {
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth+1),false,'Page horizontal overflow');
    if (d) {
      const b = await d.boundingBox(); const size=page.viewportSize();
      assert.ok(b.x >= -1 && b.y >= -1 && b.x+b.width <= size.width+1 && b.y+b.height <= size.height+1, 'Dialog outside viewport '+JSON.stringify(b));
      assert.equal(await d.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'Dialog horizontal overflow');
      const footer = d.locator('footer').last();
      if (await footer.count()) {
        const fb=await footer.boundingBox();
        assert.ok(fb && fb.y+fb.height<=size.height+1,'Footer is hidden below screen');
        const last=d.locator('input:visible,textarea:visible,select:visible').last();
        if(await last.count())await last.scrollIntoViewIfNeeded();
        const after=await footer.boundingBox();
        assert.ok(after.y>=0 && after.y+after.height<=size.height+1,'Footer moved offscreen after form scroll');
      }
    }
    await page.screenshot({path:path.join(out,id+'.png'),fullPage:!d});
  };
  try {
    await actor('owner');
    if(process.env.HUB_QA_DIALOGS_ONLY==='1'){
      const previous=JSON.parse(fs.readFileSync(path.join(out,'browser-acceptance.json'),'utf8'));
      results.push(...previous.results.filter(r=>r.pass&&/^(page-|filters-)/.test(r.id)));
    }
    for (const [width,height] of (process.env.HUB_QA_DIALOGS_ONLY==='1'?[]:[[1920,1080],[1366,768],[1280,800],[1024,768],[390,844],[430,932]])) {
      await page.setViewportSize({width,height});
      for (const view of ['Công việc','To-do','QC độc lập','KPI & thưởng','Thiết lập']) {
        await test(`page-${width}-${view}`,async()=>{await nav(view);await inspect(`page-${width}-${['Công việc','To-do','QC độc lập','KPI & thưởng','Thiết lập'].indexOf(view)}`);});
      }
      await test(`filters-${width}`,async()=>{
        await nav('To-do'); await page.getByText('Thêm tiêu chí lọc',{exact:true}).click();
        await page.getByLabel('Khoảng thời gian',{exact:true}).selectOption('custom');
        await page.getByLabel('Từ ngày',{exact:true}).fill('2026-10-01');
        await page.getByLabel('Đến hết ngày',{exact:true}).fill('2026-10-31');
        await inspect(`filters-${width}`);
        const labels=['Mức độ','Người xử lý','Bộ phận','Lọc theo ngày'];
        for(const label of labels) assert.ok(await page.getByLabel(label,{exact:true}).isVisible(),label);
      });
    }
    for (const [width,height] of [[1366,768],[390,844],[430,932]]) {
      await page.setViewportSize({width,height}); await actor('owner'); await nav('Thiết lập');
      for (const label of ['Thêm tiêu chuẩn QC','Chính sách mới','Thêm bộ phận','Phân công cùng lịch','Cấp / thu hồi QC, kế toán']) {
        await test(`popup-${width}-${label}`,async()=>{
          await page.getByRole('button',{name:label,exact:true}).click(); await inspect(`popup-${width}-${label.replace(/[^a-z0-9]/gi,'-')}`,dialog()); await close();
        });
      }
      await test(`legacy-${width}`,async()=>{
        await page.getByRole('button',{name:'Mẫu công việc và quyền Hub',exact:true}).click();
        await page.getByRole('button',{name:'Standard Working',exact:true}).click();
        await inspect(`legacy-standard-${width}`,dialog()); await close();
        await page.getByRole('button',{name:'Phân công',exact:true}).click();
        await inspect(`legacy-members-${width}`,dialog()); await close();
      });
      await test(`legacy-business-${width}`,async()=>{
        await nav('KPI & thưởng');
        for(const label of ['Chỉ tiêu','Doanh thu ngoài']){await page.getByRole('button',{name:label,exact:true}).click();await inspect(`legacy-business-${width}-${label==='Chỉ tiêu'?'target':'revenue'}`,dialog());await close();}
      });
      await actor('manager'); await nav('To-do');
      await page.getByRole('button',{name:'To-do',exact:true}).last().click();
      await dialog().getByLabel('Nội dung cần xử lý',{exact:true}).fill(`Việc giả để kiểm tra popup ${width} ${Date.now()}`);
      await dialog().getByLabel('Mô tả vấn đề / lô hàng / thiết bị',{exact:true}).fill('Dữ liệu giả cho nghiệm thu, không có trên production');
      await dialog().getByLabel('Deadline (giờ Việt Nam)',{exact:true}).fill('2026-10-30T17:00');
      await dialog().getByRole('button',{name:'Lưu',exact:true}).click();await dialog().waitFor({state:'hidden'});
      for(const [label,filename] of [['Chi tiết','issue-detail'],['Nhận việc','issue-accept'],['Kiểm tra lại','issue-recheck']]){
        await test(`${filename}-${width}`,async()=>{await page.getByRole('button',{name:label,exact:true}).filter({visible:true}).first().click();await inspect(`${filename}-${width}`,dialog());await close();});
      }
      await test(`issue-assign-${width}`,async()=>{await page.getByTitle('Đổi người chịu trách nhiệm hoặc deadline',{exact:true}).filter({visible:true}).first().click();await inspect(`issue-assign-${width}`,dialog());await close();});
      await test(`popup-issue-${width}`,async()=>{
        await page.getByRole('button',{name:'To-do',exact:true}).last().click();
        const d=dialog();
        const title='Sự cố máy pha cà phê tại quầy phục vụ chi nhánh cần kiểm tra đường nước và chất lượng đồ uống';
        await d.getByLabel('Nội dung cần xử lý',{exact:true}).fill(title);
        await d.getByLabel('Mô tả vấn đề / lô hàng / thiết bị',{exact:true}).fill('Mô tả dài để kiểm tra xuống dòng. '.repeat(30));
        const description=await d.getByLabel('Mô tả vấn đề / lô hàng / thiết bị',{exact:true}).boundingBox();
        const responsible=await d.getByText('Quản lý chịu trách nhiệm',{exact:true}).boundingBox();
        assert.ok(responsible.y-description.y-description.height>=8,'Description and next field need spacing');
        await inspect(`issue-long-${width}`,d);
        await page.keyboard.press('Escape'); await page.getByRole('button',{name:'Tiếp tục chỉnh sửa',exact:true}).click();
        assert.equal(await d.getByLabel('Nội dung cần xử lý',{exact:true}).inputValue(),title);
        await close();
      });
      await test(`save-error-retains-${width}`,async()=>{
        await page.getByRole('button',{name:'To-do',exact:true}).last().click(); const d=dialog();
        await d.getByLabel('Nội dung cần xử lý',{exact:true}).fill('Không được mất khi lưu lỗi');
        await d.getByLabel('Mô tả vấn đề / lô hàng / thiết bị',{exact:true}).fill('Dữ liệu giả');
        await d.getByLabel('Deadline (giờ Việt Nam)',{exact:true}).fill('2026-10-30T17:00');
        let posts=0;
        const handler=async route=>{if(route.request().method()==='POST'){posts++;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Lỗi mạng giả lập, chưa lưu'})});}else await route.fallback();};
        await page.route('**/api/operations/quality',handler);
        await d.getByRole('button',{name:'Lưu',exact:true}).click(); await d.getByRole('alert').waitFor();
        assert.equal(await d.getByLabel('Nội dung cần xử lý',{exact:true}).inputValue(),'Không được mất khi lưu lỗi');
        await page.waitForTimeout(800); assert.equal(posts,1,'No automatic retry storm');
        await page.unroute('**/api/operations/quality',handler); await close();
      });
      await actor('qc'); await nav('QC độc lập');
      await test(`qc-create-${width}`,async()=>{await page.getByRole('button',{name:'Tạo đợt QC',exact:true}).click(); await inspect(`qc-create-${width}`,dialog());await close();});
      const draftTitle=`QC popup ${width} ${Date.now()}`;
      await page.getByRole('button',{name:'Tạo đợt QC',exact:true}).click();await dialog().getByLabel('Tên đợt kiểm tra',{exact:true}).fill(draftTitle);await dialog().getByRole('button',{name:'Lưu',exact:true}).click();await dialog().waitFor({state:'hidden'});
      await test(`qc-line-${width}`,async()=>{await page.getByRole('row').filter({hasText:draftTitle}).or(page.locator('article').filter({hasText:draftTitle})).filter({visible:true}).first().getByRole('button',{name:'Mở đợt',exact:true}).click();await page.getByRole('button',{name:'Ghi kết quả',exact:true}).filter({visible:true}).first().click();await inspect(`qc-line-${width}`,dialog());await close();});
      await test(`qc-correct-${width}`,async()=>{await page.getByRole('button',{name:'Danh sách đợt QC',exact:true}).click();const completed=page.getByRole('row').filter({hasText:'Đã hoàn tất'}).or(page.locator('article').filter({hasText:'Đã hoàn tất'})).filter({visible:true}).first();await completed.getByRole('button',{name:'Mở đợt',exact:true}).click();await page.getByRole('button',{name:'Đính chính',exact:true}).filter({visible:true}).first().click();await inspect(`qc-correct-${width}`,dialog());await close();});
      await actor('accounting'); await nav('KPI & thưởng');
      await test(`accounting-${width}`,async()=>{await page.getByRole('button',{name:'Ghi số liệu kế toán',exact:true}).click();await inspect(`accounting-${width}`,dialog());await close();});
    }
    await test('browser-runtime-errors',()=>assert.deepEqual(errors,[]));
  } finally {
    fs.writeFileSync(path.join(out,'browser-acceptance.json'),JSON.stringify({results,errors},null,2));
    await browser.close();
  }
  console.log('RESULT',results.filter(r=>r.pass).length,'pass',results.filter(r=>!r.pass).length,'fail');
  if(results.some(r=>!r.pass)) process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
