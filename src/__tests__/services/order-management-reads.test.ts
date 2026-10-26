import {beforeEach,describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({orders:[] as Record<string,unknown>[],orderCalls:[] as Record<string,unknown>[],customers:[] as Record<string,unknown>[],lines:[] as Record<string,unknown>[],queries:[] as Record<string,unknown>[],fail:false}));
vi.mock('@/lib/services/supabase/sales-order-list-scope',()=>({getOrdersTheoPhamVi:async(scope:unknown,p:Record<string,unknown>)=>{
  f.orderCalls.push({scope,...p});const ids=(p.filters as {ids?:string[]})?.ids;
  const rows=ids?f.orders.filter(o=>ids.includes(String(o.id))):f.orders;
  const start=Number(p.page)*Number(p.pageSize);return {data:rows.slice(start,start+Number(p.pageSize)),total:rows.length};
}}));
vi.mock('@/lib/services/supabase/base',()=>({getCurrentTenantId:async()=> 'tenant',getClient:()=>({from:(table:string)=>{
  const state:{table:string;cols?:string;filters:unknown[];offset:number;size:number}={table,filters:[],offset:0,size:200};
  const q={select(cols:string){state.cols=cols;return q;},eq(...a:unknown[]){state.filters.push(a);return q;},in(...a:unknown[]){state.filters.push(a);return q;},order(){return q;},range(a:number,b:number){state.offset=a;state.size=b-a+1;return q;},then(resolve:(v:unknown)=>unknown){f.queries.push({...state});const rows=table==='customers'?f.customers:f.lines;return Promise.resolve({data:rows.slice(state.offset,state.offset+state.size),count:rows.length,error:f.fail?{message:'Read failed'}:null}).then(resolve);}};return q;}})}));
import {getForecastCustomerOptions,readOrdersForExport} from '@/lib/services/supabase/order-management-reads';
import {buildOrderExportRows,orderLineColumns} from '@/lib/utils/sales-order-export';
import type {SalesOrder} from '@/lib/types';
const scope={mode:'branch' as const,branchId:'branch',duocDemChiNhanhKhac:false};
beforeEach(()=>{f.orders=[];f.orderCalls=[];f.customers=[];f.lines=[];f.queries=[];f.fail=false;});
describe('read-only management exports',()=>{
 it('reads all 451 matching orders in the same scope and filters, starting at page zero',async()=>{
  f.orders=Array.from({length:451},(_,i)=>({id:String(i)}));
  const params={search:'DH',filters:{status:['draft'],dateFrom:'2026-10-01'}};
  const r=await readOrdersForExport(scope,params);expect(r.orders).toHaveLength(451);
  expect(f.orderCalls.map(c=>c.page)).toEqual([0,1,2]);
  expect(f.orderCalls.every(c=>c.scope===scope&&c.search==='DH'&&(c.filters as {dateFrom:string}).dateFrom==='2026-10-01')).toBe(true);
 });
 it('exports exactly selected IDs, never the other visible orders',async()=>{
  f.orders=[{id:'a'},{id:'b'},{id:'c'}];const r=await readOrdersForExport(scope,{},['a','c']);
  expect(r.orders.map(o=>o.id)).toEqual(['a','c']);expect((f.queries[0].filters as unknown[][])[0]).toEqual(['invoice_id',['a','c']]);
 });
 it('rejects missing scope and selected documents no longer visible',async()=>{
  await expect(readOrdersForExport({mode:'none',duocDemChiNhanhKhac:false},{})).rejects.toThrow('phạm vi');
  await expect(readOrdersForExport(scope,{},['gone'])).rejects.toThrow('đã thay đổi');
 });
 it('loads every line and surfaces page errors instead of silently exporting empty details',async()=>{
  f.orders=[{id:'a'}];f.lines=Array.from({length:451},(_,i)=>({id:String(i),invoice_id:'a'}));
  expect((await readOrdersForExport(scope,{})).lines).toHaveLength(451);
  f.fail=true;await expect(readOrdersForExport(scope,{})).rejects.toThrow('Read failed');
 });
 it('reads customers from the first page with tenant scope, including NB and beyond 500',async()=>{
  f.customers=Array.from({length:601},(_,i)=>({id:String(i),code:`KH${i}`,name:i?'Khách':'NB: Tư Búa',phone:null}));
  const r=await getForecastCustomerOptions();expect(r).toHaveLength(601);expect(r[0].name).toBe('NB: Tư Búa');
  expect(f.queries[0].offset).toBe(0);expect(f.queries.every(q=>(q.filters as unknown[][]).some(v=>v[0]==='tenant_id'&&v[1]==='tenant'))).toBe(true);
  expect(f.queries.every(q=>!(q.filters as unknown[][]).some(v=>v[0]==='is_internal'))).toBe(true);
 });
 it('keeps line notes and numeric quantities, and avoids repeating totals in detail columns',()=>{
  const rows=buildOrderExportRows([{id:'a',code:'DH1',note:'Ghi chú đơn'} as SalesOrder],[{id:'l',invoice_id:'a',product_name:'Hàng',products:{code:'SKU1'},unit:'Kg',quantity:0.125,unit_price:24000,discount:0,total:3000,note:'Ghi chú mã'}]);
  expect(rows[0]).toMatchObject({code:'DH1',note:'Ghi chú đơn',quantity:0.125,lineTotal:3000,lineNote:'Ghi chú mã'});
  expect(orderLineColumns.map(c=>c.key)).not.toContain('totalAmount');
 });
});
