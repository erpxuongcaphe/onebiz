import {beforeEach,describe,it,expect,vi} from 'vitest';
import * as XLSX from 'xlsx';
import {exportToExcel} from '@/lib/utils/export';
import {exportReportToExcel} from '@/lib/utils/excel-export';
import {buildOrderExportRows,buildOrderExportSheets,orderSummaryColumns,orderLineColumns} from '@/lib/utils/sales-order-export';
import type {SalesOrder} from '@/lib/types';
const f=vi.hoisted(()=>({save:vi.fn()}));
vi.mock('file-saver',()=>({saveAs:f.save,default:f.save}));
const readBlob=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
beforeEach(()=>vi.clearAllMocks());
describe('downloaded workbook content',()=>{
 it('exports full order/customer/VAT/creator information without multiplying totals by item count',async()=>{
  const orders=[{id:'a',code:'DH-TEST',date:'2026-10-27T03:00:00Z',branchName:'Kho thử',customerId:'alias',canonicalCustomerId:'canonical',customerCode:'KHA-NBO-TEST',originalCustomerCode:'KH-NB-TEST',customerName:'Chi nhánh thử',customerPhone:'0900123456',customerAddress:'Địa chỉ thử',createdBy:'user-id',createdByName:'Nhân viên thử',totalAmount:13400,discountAmount:100,taxAmount:1000,shippingFee:500,paid:0,debt:13400,status:'draft',statusName:'Chờ xử lý',note:'=Ghi chú nguyên văn',completedChildCodes:['HD-TEST']} as SalesOrder,
    {id:'b',code:'DH-HUY',date:'2026-10-27T04:00:00Z',customerId:'canonical',canonicalCustomerId:'canonical',customerCode:'KHA-NBO-TEST',customerName:'Chi nhánh thử',customerPhone:'0900123456',totalAmount:300,paid:0,debt:300,status:'cancelled',statusName:'Đã hủy',createdBy:'user-id'} as SalesOrder];
  const line={id:'l1',invoice_id:'a',products:{code:'SKU-TEST'},product_name:'Hàng thử',unit:'Kg',quantity:0.125,unit_price:48000,discount:0,total:6000,vat_rate:8,note:'Giao riêng'};
  const sheets=buildOrderExportSheets(orders,[line,{...line,id:'l2',vat_rate:null}],['ĐƠN — TRANG 2','Khách: Chi nhánh thử · Ngày: 27/10/2026']);
  await exportReportToExcel({kind:'dat-hang',mode:'full',range:{from:'2026-10-27',to:'2026-10-27'},description:'Trang 2 · Khách: Chi nhánh thử',sheets});
  const wb=XLSX.read(await readBlob(f.save.mock.calls[0][0]),{type:'array'});
  expect(wb.SheetNames).toEqual(['Thông tin','Đơn đặt hàng','Chi tiết hàng đặt','Theo khách hàng']);
  const table=(name:string,label:string)=>{const a=XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name],{header:1,defval:''});const index=a.findIndex(r=>r[0]===label);return a.slice(index+1).filter(r=>r.some(v=>v!=='')).map(r=>Object.fromEntries(a[index].map((h,i)=>[String(h),r[i]])));};
  const headers=table('Đơn đặt hàng','Mã đặt hàng');expect(headers).toHaveLength(2);
  expect(headers[0]).toMatchObject({'Mã khách hàng':'KHA-NBO-TEST','Mã hồ sơ gốc':'KH-NB-TEST','Địa chỉ':'Địa chỉ thử','Người tạo':'Nhân viên thử','Thuế VAT đơn':1000,'Phí giao hàng':500,'Hóa đơn liên quan':'HD-TEST','Ghi chú đơn':'=Ghi chú nguyên văn'});
  const details=table('Chi tiết hàng đặt','Mã đặt hàng');expect(details).toHaveLength(3);
  expect(details[0]).toMatchObject({'Số lượng':0.125,'VAT dòng (%)':8,'Ghi chú mã hàng':'Giao riêng'});
  expect(details[1]['VAT dòng (%)']).toBe('');expect(details[2]['Tên hàng']).toBe('(Không có dòng hàng)');
  expect(details[0]).not.toHaveProperty('Tổng tiền');
  const customers=table('Theo khách hàng','Mã khách hàng');expect(customers).toHaveLength(1);
  expect(customers[0]).toMatchObject({'Số đơn':2,'Giá trị đơn còn hiệu lực':13400,'Giá trị đơn hủy':300,'Còn nợ trên đơn':13400});
  const cells=Object.values(wb.Sheets['Đơn đặt hàng']).filter(c=>c&&typeof c==='object'&&'v' in c&&c.v==='=Ghi chú nguyên văn');
  expect(cells[0]).toMatchObject({t:'s'});expect(cells[0]).not.toHaveProperty('f');
 });
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
