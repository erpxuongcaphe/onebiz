import {beforeEach,describe,it,expect,vi} from 'vitest';
import * as XLSX from 'xlsx';
import {exportToExcel} from '@/lib/utils/export';
import {exportReportToExcel} from '@/lib/utils/excel-export';
import {buildOrderExportRows,orderSummaryColumns,orderLineColumns} from '@/lib/utils/sales-order-export';
import type {SalesOrder} from '@/lib/types';
const f=vi.hoisted(()=>({save:vi.fn()}));
vi.mock('file-saver',()=>({saveAs:f.save,default:f.save}));
const readBlob=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
beforeEach(()=>vi.clearAllMocks());
describe('downloaded workbook content',()=>{
 it('builds both sheets with literal notes, exact selected order and numeric 4-decimal quantities',async()=>{
  const orders=[{id:'one',code:'DH-TEST',date:'2026-10-26',customerName:'NB: Chi nhánh thử',customerPhone:'0901',totalAmount:2962.8,note:'Chỉ ghi chú nhân viên',statusName:'Chờ xử lý'} as SalesOrder];
  const rows=buildOrderExportRows(orders,[{id:'line',invoice_id:'one',products:{code:'SKU-TEST'},product_name:'Hàng thử',unit:'Kg',quantity:0.12345,unit_price:24000,discount:0,total:2962.8,note:'=ghi chú nguyên văn'}]);
  await exportToExcel(orders,orderSummaryColumns,'test-only',{additionalSheets:[{name:'Chi tiet hang dat',data:rows,columns:orderLineColumns}]});
  const wb=XLSX.read(await readBlob(f.save.mock.calls[0][0]),{type:'array'});
  expect(wb.SheetNames).toEqual(['Data','Chi tiet hang dat']);
  const details=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets['Chi tiet hang dat']);
  expect(details).toHaveLength(1);expect(details[0]).toMatchObject({'Mã đặt hàng':'DH-TEST','Ghi chú đơn':'Chỉ ghi chú nhân viên','Số lượng':0.1235,'Thành tiền dòng':2962.8,'Ghi chú mã hàng':'=ghi chú nguyên văn'});
  expect(typeof details[0]['Số lượng']).toBe('number');
 });
 it('never downloads a forecast with an obsolete filter identity',async()=>{
  await expect(exportReportToExcel({kind:'du-kien-mua-hang',mode:'full',range:{from:'2026-10-01',to:'2026-10-26'},shouldSave:()=>false,sheets:[{name:'Thử',columns:[{label:'Mã',key:'code'}],rows:[{code:'TEST'}]}]})).rejects.toThrow('Bộ lọc đã thay đổi');
  expect(f.save).not.toHaveBeenCalled();
 });
});
