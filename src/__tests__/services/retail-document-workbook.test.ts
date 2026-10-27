import {beforeEach,describe,expect,it,vi} from 'vitest';
import * as XLSX from 'xlsx';
import type {Invoice} from '@/lib/types';
import type {OrderExportLine} from '@/lib/services/supabase/order-management-reads';
import {buildRetailDocumentExport,buildRetailDocumentSheets,retailDocumentExportRange,retailDocumentExportScopeText,retailDocumentStatusLabel} from '@/lib/utils/retail-document-export';
import {exportReportToExcel} from '@/lib/utils/excel-export';
const mock=vi.hoisted(()=>({save:vi.fn()}));
vi.mock('file-saver',()=>({saveAs:mock.save,default:mock.save}));
const invoice=(id='i',customerId='c',status:Invoice['status']='completed')=>({id,code:`HD-${id}`,date:'2026-10-27T03:00:00Z',source:'pos',orderCode:'NH-TRUOC',sourceOrderCode:'DH-1',branchName:'Kho thử',customerId,customerCode:`KHA-${customerId}`,customerName:'Khách trùng tên',customerPhone:'0900123456',customerAddress:'Địa chỉ thử',totalAmount:2962.8,discount:0,shippingFee:0,taxAmount:0,paid:2000,debt:962.8,status,note:'Ghi chú của nhân viên'} as Invoice);
const line=(invoice_id='i')=>({id:'line-'+invoice_id,invoice_id,products:{code:'SKU-THU'},product_name:'Hàng thử',unit:'Kg',quantity:.12345,unit_price:24000,discount:0,total:2962.8,note:'=ghi chú nguyên văn'} as OrderExportLine);
beforeEach(()=>vi.clearAllMocks());
describe('Retail document export workbook',()=>{
 it('distinguishes unfinished Retail drafts consistently without changing F&B status labels',()=>{
  expect(retailDocumentStatusLabel({...invoice(),code:'NH000412',status:'processing'})).toBe('Nháp · chưa xuất');
  expect(retailDocumentStatusLabel({...invoice(),code:'NH000412',status:'completed'})).toBe('Hoàn thành');
  expect(retailDocumentStatusLabel({...invoice(),code:'NH000412',status:'processing',source:'fnb'})).toBe('Đang xử lý');
 });
 it('uses the min/max business dates even when the UI is sorted newest first',()=>{
  expect(retailDocumentExportRange([{...invoice('1'),date:'2026-10-27T03:00:00Z'},{...invoice('2'),date:'2026-10-18T18:00:00Z'}],{})).toEqual({from:'2026-10-19',to:'2026-10-27'});
  expect(retailDocumentExportScopeText({search:'Tư Búa',filters:{status:['processing'],retailSaleType:'internal'}})).toBe('Trạng thái: Đang xử lý · Tìm kiếm: Tư Búa · Loại bán: Bán nội bộ');
 });
 it('carries customer identity, original order, quantity and both literal notes without repeating document totals per item',()=>{
  const out=buildRetailDocumentExport([invoice()],[line()]);
  expect(out.details[0]).toMatchObject({customerCode:'KHA-c',customerName:'Khách trùng tên',customerPhone:'0900123456',customerAddress:'Địa chỉ thử',orderCode:'NH-TRUOC',sourceOrderCode:'DH-1',productCode:'SKU-THU',quantity:.12345,lineNote:'=ghi chú nguyên văn',note:'Ghi chú của nhân viên'});
  expect(out.details[0]).not.toHaveProperty('totalAmount');
 });
 it('groups by customer ID, not fuzzy or identical names, and separates cancelled value',()=>{
  const out=buildRetailDocumentExport([invoice('1','a'),invoice('2','b'),invoice('3','a','cancelled')],[]);
  expect(out.customers).toHaveLength(2);
  expect(out.customers[0]).toMatchObject({documentCount:2,documentValue:2962.8,cancelledValue:2962.8,paid:2000});
 });
 it('does not merge unrelated walk-in documents and retains documents without item rows',()=>{
  const out=buildRetailDocumentExport([invoice('1',''),invoice('2','')],[]);
  expect(out.customers).toHaveLength(2);expect(out.details).toHaveLength(2);
  expect(out.details[0].productName).toContain('Không có dòng hàng');
 });
 it('keeps distinct walk-in bills separate even when they share the singleton customer ID',()=>{
  const out=buildRetailDocumentExport([{...invoice('1','walk-in'),customerCode:'KL-VL'},{...invoice('2','walk-in'),customerCode:'KL-VL'}],[]);
  expect(out.customers).toHaveLength(2);
 });
 it('rejects orphan lines and invalid numeric fields instead of downloading misleading data',()=>{
  expect(()=>buildRetailDocumentExport([invoice()],[line('other')])).toThrow('không thuộc');
  expect(()=>buildRetailDocumentExport([invoice()],[{...line(),quantity:NaN}])).toThrow('chưa hợp lệ');
 });
 it('writes styled summary, item and customer sheets with filterable numeric cells and text phone/note cells',async()=>{
  const sheets=buildRetailDocumentSheets([invoice()],[line()],['CHỨNG TỪ THỬ','Chọn 1 chứng từ']);
  await exportReportToExcel({kind:'ban-hang',mode:'full',range:{from:'2026-10-27',to:'2026-10-27'},sheets});
  const blob=mock.save.mock.calls[0][0] as Blob;
  const bytes=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
  const book=XLSX.read(bytes,{type:'array',cellStyles:true});
  expect(book.SheetNames).toEqual(expect.arrayContaining(['Chứng từ','Chi tiết hàng','Theo khách hàng']));
  const sheet=book.Sheets['Chi tiết hàng'];
  const table=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1});
  const head=table.findIndex(row=>row.includes('Mã chứng từ'));const row=table[head+1];
  const headers=table[head];
  expect(row[headers.indexOf('Mã khách hàng')]).toBe('KHA-c');
  expect(row[headers.indexOf('SĐT')]).toBe('0900123456');
  expect(row[headers.indexOf('Ghi chú mã hàng')]).toBe('=ghi chú nguyên văn');
  expect(row[headers.indexOf('Số lượng')]).toBe(.12345);
  expect(sheet['!autofilter']).toBeTruthy();
  expect(sheet[XLSX.utils.encode_cell({r:head+1,c:headers.indexOf('Số lượng')})].t).toBe('n');
 });
});
