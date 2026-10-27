import {beforeEach,describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],missing:false,calls:[] as unknown[][][]}));
vi.mock('@/lib/services/supabase/base',()=>({getCurrentTenantId:async()=> 'tenant',getPaginationRange:(p:{page:number;pageSize:number})=>({from:p.page*p.pageSize,to:(p.page+1)*p.pageSize-1}),getClient:()=>({from:()=>{
 const state={filters:[] as unknown[][],from:0,to:999};
 const q={select(){return q;},eq(k:string,v:unknown){state.filters.push(['eq',k,v]);return q;},in(k:string,v:unknown[]){state.filters.push(['in',k,v]);return q;},is(k:string,v:unknown){state.filters.push(['is',k,v]);return q;},not(){return q;},order(){return q;},gte(){return q;},lte(){return q;},range(a:number,b:number){state.from=a;state.to=b;return q;},then(resolve:(v:unknown)=>unknown){
  f.calls.push(state.filters);
  const children=state.filters.some(v=>Array.isArray(v)&&v[1]==='source_order_id');
  const rows=f.rows.filter(r=>state.filters.every(([op,k,v])=>op==='in'?(v as unknown[]).includes(r[String(k)]):op==='is'?(r[String(k)]??null)===v:r[String(k)]===v));
  return Promise.resolve({data:rows.slice(state.from,state.to+1),count:rows.length,error:children&&f.missing?{code:'42703',message:'missing column'}:null}).then(resolve);
 }};return q;}}),handleError:(e:{message:string})=>{throw new Error(e.message);}}));
import {getOrders} from '@/lib/services/supabase/orders';
const parent=(id:string)=>({id,code:id,tenant_id:'tenant',branch_id:'warehouse',source:'order',status:'draft',deleted_at:null,fulfilled_by_id:null,total:1});
const child=(id:string,order:string,extra={})=>({id,code:id,tenant_id:'tenant',source:'pos',source_order_id:order,status:'completed',deleted_at:null,voided_at:null,cancelled_at:null,...extra});
beforeEach(()=>{f.rows=[];f.missing=false;f.calls=[];});
describe('POS only uninvoiced orders without embedded self-relation loss',()=>{
 it('keeps a real pending parent and drafts/voided/cancelled children, excludes valid invoices and closed parents',async()=>{
  f.rows=[parent('pending'),parent('invoiced'),parent('draft-only'),parent('voided'),parent('cancelled'),{...parent('closed'),fulfilled_by_id:'posted'},child('hd','invoiced'),child('nh','draft-only',{status:'draft'}),child('void','voided',{voided_at:'2026-10-26'}),child('cancel','cancelled',{status:'cancelled'})];
  const r=await getOrders({page:0,pageSize:50,branchId:'warehouse',filters:{fulfillmentState:'pending'}});
  expect(r.data.map(o=>o.id)).toEqual(['pending','draft-only','voided','cancelled']);expect(r.total).toBe(4);
 });
 it('reads over 200 candidates and filters before UI pagination, without limiting child invoices',async()=>{
  const parents=Array.from({length:501},(_,i)=>parent(`p${i}`));f.rows=[...parents,...parents.filter((_,i)=>i%2===0).map(p=>child('hd'+p.id,String(p.id)))];
  const r=await getOrders({page:1,pageSize:50,branchId:'warehouse',filters:{fulfillmentState:'pending'}});
  expect(r.total).toBe(250);expect(r.data.map(o=>o.id)).toEqual(parents.filter((_,i)=>i%2===1).slice(50,100).map(p=>p.id));
  expect(f.calls.every(filters=>filters.some(v=>Array.isArray(v)&&v[1]==='tenant_id'&&v[2]==='tenant'))).toBe(true);
 });
 it('processing uses the same complete comparison and missing child metadata fails visibly',async()=>{
  f.rows=[parent('pending'),parent('invoiced'),child('hd','invoiced')];
  expect((await getOrders({page:0,pageSize:50,filters:{fulfillmentState:'processing'}})).data.map(o=>o.id)).toEqual(['invoiced']);
  f.missing=true;await expect(getOrders({page:0,pageSize:50,filters:{fulfillmentState:'pending'}})).rejects.toThrow('Chưa xác định');
 });
});
