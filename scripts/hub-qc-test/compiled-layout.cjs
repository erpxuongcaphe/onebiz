const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.HUB_PLAYWRIGHT_DIR || 'playwright');
const {twMerge} = require('tailwind-merge');
const root = path.resolve(__dirname, '../..');
function files(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
}
(async()=>{
 const sheets=files(path.join(root,'.next/static')).filter(file=>file.endsWith('.css')).map(file=>fs.readFileSync(file,'utf8'));
 const modulePattern=/(?:quality-module__[\w-]+__dialog|quality_dialog__[\w-]+)\b/;
 const moduleSheet=sheets.find(css=>modulePattern.test(css));
 assert.ok(moduleSheet,'Built production Hub CSS is required');
 const dialogClass=moduleSheet.match(modulePattern)[0];
 const classes=twMerge('fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg bg-popover p-4 text-sm',`${dialogClass} translate-x-0 translate-y-0`);
 assert.ok(!classes.includes('-translate-x-1/2')&&!classes.includes('-translate-y-1/2'),'Tailwind centering translations must be removed before module CSS positions the dialog');
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.abort());
  for(const [width,height] of [[1920,1080],[1366,768],[1280,800],[1024,768],[390,844],[430,932],[390,480]]){
   await page.setViewportSize({width,height});
   await page.setContent(`<style>${sheets.join('\n')}</style><div role="dialog" class="${classes}"><h2>Kiểm tra popup Hub</h2><p>Nội dung thử bố cục bằng CSS production</p><button>Lưu</button></div>`);
   const box=await page.getByRole('dialog').boundingBox();
   assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=width+1&&box.y+box.height<=height+1,JSON.stringify({width,height,box}));
   console.log('PASS built production CSS dialog bounds',width,height,JSON.stringify(box));
  }
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
