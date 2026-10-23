import {describe,it,expect,vi,beforeEach} from "vitest";
const m=vi.hoisted(()=>({calls:[] as {op:string,args:unknown[]}[],rpc:vi.fn()}));
vi.mock("@/lib/services/supabase/base",()=>({getCurrentTenantId:async()=>"tenant",getPaginationRange:()=>({from:200,to:399}),handleError:(e:Error)=>{throw e;},getClient:()=>({rpc:m.rpc,from:()=>{const q:Record<string,unknown>={};for(const op of ['select','eq','is','or','in','ilike','gte','lt','lte','contains','order','range'])q[op]=(...args:unknown[])=>{m.calls.push({op,args});return q;};q.then=(f:(r:unknown)=>unknown)=>Promise.resolve({data:[],count:0,error:null}).then(f);return q;}})}));
import {getInvoices,getInvoiceListSummary,khoaChiSoHoaDon} from "@/lib/services/supabase/invoices";
import {choiceKey} from "@/lib/utils/fnb-invoice-choice-filter";
beforeEach(()=>{m.calls=[];m.rpc.mockReset().mockResolvedValue({data:[{}],error:null});});
describe('server-side option query',()=>{
 it('applies all choices to one embedded item relation before range, retaining parent count/pagination',async()=>{
 const key=choiceKey('Đá/Nóng');await getInvoices({page:1,pageSize:200,branchId:'branch',filters:{fnbOptions:JSON.stringify({size:'Size L',groups:{[key]:'Nóng'}})}});
 expect(String(m.calls.find(c=>c.op==='select')?.args[0])).toContain('fnb_option_rows:fnb_invoice_option_items_20261023!inner(id)');
 expect(m.calls).toContainEqual({op:'eq',args:['fnb_option_rows.size','Size L']});expect(m.calls).toContainEqual({op:'contains',args:['fnb_option_rows.choices',{[key]:['Nóng']}]});expect(m.calls.findIndex(c=>c.op==='contains')).toBeLessThan(m.calls.findIndex(c=>c.op==='range'));
 });
 it('uses missing JSON keys and routes KPI through the identical same-item predicate',async()=>{
 const key=choiceKey('Mức ngọt'),fnbOptions=JSON.stringify({groups:{[key]:'__missing__'}});
 await getInvoices({page:0,pageSize:20,filters:{fnbOptions}});expect(m.calls).toContainEqual({op:'is',args:[`fnb_option_rows.choices->${key}`,null]});
 await getInvoiceListSummary({branchId:'branch',fnbOptions});expect(m.rpc.mock.calls[0][0]).toBe('get_invoice_list_summary_fnb_choices_20261023');expect(m.rpc.mock.calls[0][1].p_options).toEqual(JSON.parse(fnbOptions));expect(khoaChiSoHoaDon({fnbOptions})).not.toBe(khoaChiSoHoaDon({}));
 });
});
