import {act,renderHook} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Invoice} from '@/lib/types';
const f=vi.hoisted(()=>({headers:vi.fn(),writer:vi.fn(),csv:vi.fn(),rows:[] as Record<string,unknown>[],calls:[] as unknown[][]}));
vi.mock('@/lib/services/supabase/invoice-list-export',()=>({getInvoicesForFilteredExport:f.headers}));
vi.mock('@/lib/utils/excel-export',()=>({exportReportToExcel:f.writer}));
vi.mock('@/lib/utils/export',()=>({exportToExcel:vi.fn(),exportToCsv:f.csv}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>({from:(table:string)=>{
 f.calls.push(['from',table]);const builder:Record<string,unknown>={};
 for(const method of ['select','in','order'])builder[method]=(...args:unknown[])=>{f.calls.push([method,...args]);return builder;};
 builder.range=(from:number,to:number)=>Promise.resolve({data:f.rows.slice(from,to+1),count:f.rows.length,error:null});return builder;
}})}));
import {useInvoiceListExport} from '@/lib/hooks/use-invoice-list-export';
import {readSelectedInvoiceExport,readRetailDocumentExportLines} from '@/lib/services/supabase/retail-document-export';
const scope={mode:'branch' as const,branchId:'warehouse',duocDemChiNhanhKhac:false};
beforeEach(()=>{vi.clearAllMocks();f.calls=[];f.rows=[];});
describe('scope-checked Retail export reads',()=>{
 it('rereads only selected IDs under the same filters and refuses missing selections',async()=>{
  f.headers.mockResolvedValue([{id:'b'},{id:'a'}]);
  const filters={status:['completed'],dateFrom:'2026-10-01'};
  expect((await readSelectedInvoiceExport(scope,{filters},['a','b'])).map(row=>row.id)).toEqual(['a','b']);
  expect(f.headers).toHaveBeenCalledWith(scope,{filters:{...filters,ids:['a','b']}},expect.anything());
  f.headers.mockResolvedValue([{id:'a'}]);await expect(readSelectedInvoiceExport(scope,{filters},['a','b'])).rejects.toThrow('thay đổi');
 });
 it('reads every line page without a 100/500/1000 cap and retains notes',async()=>{
  f.rows=Array.from({length:1237},(_,i)=>({id:String(i),invoice_id:'a',note:'Ghi chú dòng '+i}));
  const result=await readRetailDocumentExportLines([{id:'a',source:'pos'} as Invoice]);
  expect(result).toHaveLength(1237);expect(result.at(-1)?.note).toBe('Ghi chú dòng 1236');
  expect(f.calls).toContainEqual(['from','invoice_items_scoped']);
  expect(f.calls).toContainEqual(['in','invoice_id',['a']]);
 });
 it('does not read F&B items through the Retail reader',async()=>{
  expect(await readRetailDocumentExportLines([{id:'f',source:'fnb'} as Invoice])).toEqual([]);
  expect(f.calls).toEqual([]);
 });
 it('rejects out-of-scope items and cancellation before saving',async()=>{
  f.rows=[{id:'bad',invoice_id:'other'}];
  await expect(readRetailDocumentExportLines([{id:'a'} as Invoice])).rejects.toThrow('không thuộc');
  const controller=new AbortController();controller.abort();
  await expect(readSelectedInvoiceExport(scope,{},['a'],controller.signal)).rejects.toMatchObject({name:'AbortError'});
 });
});

const header={id:'a',code:'NH-THU',date:'2026-10-27T03:00:00Z',branchName:'Kho thử',source:'pos',customerId:'c',customerCode:'KHA-THU',customerName:'Khách thử',customerPhone:'0900123456',customerAddress:'Địa chỉ thử',totalAmount:3000,discount:0,shippingFee:0,taxAmount:0,paid:0,debt:3000,status:'processing',note:'Ghi chú đơn'} as Invoice;
const validLine={id:'l',invoice_id:'a',products:{code:'SKU-THU'},product_name:'Hàng thử',unit:'Kg',quantity:0.5,unit_price:6000,discount:0,total:3000,note:'Ghi chú mã'};
function options(){return {scope,query:{filters:{status:['processing'],dateFrom:'2026-10-01',dateTo:'2026-10-27'}},ready:true,allowed:true,fnb:false,onError:vi.fn(),onSuccess:vi.fn()};}
describe('Retail full-filter export interaction',()=>{
 it('writes the item and customer sheets with the same scoped headers and notes',async()=>{
  f.headers.mockResolvedValue([header]);f.rows=[validLine];f.writer.mockResolvedValue(undefined);
  const opts=options(),{result}=renderHook(()=>useInvoiceListExport(opts));
  await act(async()=>{await result.current.start('excel');});
  expect(f.writer).toHaveBeenCalledOnce();const out=f.writer.mock.calls[0][0];
  expect(out.sheets.map((sheet:{name:string})=>sheet.name)).toEqual(['Chứng từ','Chi tiết hàng','Theo khách hàng']);
  expect(out.sheets[1].rows[0]).toMatchObject({customerCode:'KHA-THU',lineNote:'Ghi chú mã',note:'Ghi chú đơn',quantity:0.5});
  expect(opts.onSuccess).toHaveBeenCalledWith(1);
 });
 it('cancels a lazy workbook when the filter changes before saving',async()=>{
  f.headers.mockResolvedValue([header]);f.rows=[validLine];let finish!:()=>void;
  f.writer.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const opts=options(),{result,rerender}=renderHook(o=>useInvoiceListExport(o),{initialProps:opts});
  let work!:Promise<void>;await act(async()=>{work=result.current.start('excel');});
  const guard=f.writer.mock.calls[0][0].shouldSave;expect(guard()).toBe(true);
  rerender({...opts,scope:{...scope,branchId:'other'}});expect(guard()).toBe(false);
  await act(async()=>{finish();await work;});expect(opts.onSuccess).not.toHaveBeenCalled();expect(opts.onError).not.toHaveBeenCalled();
 });
 it('retains detail rows and notes in CSV and refuses a missing permission',async()=>{
  f.headers.mockResolvedValue([header]);f.rows=[validLine];f.csv.mockResolvedValue(undefined);
  const opts=options(),{result,rerender}=renderHook(o=>useInvoiceListExport(o),{initialProps:opts});
  await act(async()=>{await result.current.start('csv');});expect(f.csv.mock.calls[0][0][0]).toMatchObject({code:'NH-THU',productCode:'SKU-THU',lineNote:'Ghi chú mã'});
  f.headers.mockClear();rerender({...opts,allowed:false});await act(async()=>{await result.current.start('excel');});
  expect(f.headers).not.toHaveBeenCalled();expect(opts.onError).toHaveBeenCalledOnce();
 });
});
