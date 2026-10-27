import {beforeEach,describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({tables:{} as Record<string,Record<string,unknown>[]>,fail:'',calls:[] as {table:string;filters:unknown[][];offset:number}[]}));
vi.mock('@/lib/services/supabase/base',()=>({getCurrentTenantId:async()=> 'tenant',getClient:()=>({rpc:async()=>({data:[],error:null}),from:(table:string)=>{
 const state={table,filters:[] as unknown[][],offset:0,size:200};
 const q={select(){return q;},eq(k:string,v:unknown){state.filters.push(['eq',k,v]);return q;},in(k:string,v:unknown[]){state.filters.push(['in',k,v]);return q;},is(k:string,v:unknown){state.filters.push(['is',k,v]);return q;},gte(){return q;},lt(){return q;},order(){return q;},range(a:number,b:number){state.offset=a;state.size=b-a+1;return q;},then(resolve:(v:unknown)=>unknown){
  f.calls.push({...state,filters:[...state.filters]});
  const rows=(f.tables[table]??[]).filter(r=>state.filters.every(([op,k,v])=>op==='in'?(v as unknown[]).includes(r[String(k)]):op==='is'?(r[String(k)]??null)===v:r[String(k)]===v));
  return Promise.resolve({data:rows.slice(state.offset,state.offset+state.size),count:rows.length,error:f.fail===table?{message:'Synthetic read failed'}:null}).then(resolve);
 }};return q;}})}));
import {getPurchaseForecast} from '@/lib/services/supabase/purchase-forecast';
beforeEach(()=>{f.fail='';f.calls=[];f.tables={branches:[{id:'w',name:'Kho tổng',tenant_id:'tenant',branch_type:'warehouse'}],products_scoped:[{id:'p',tenant_id:'tenant',code:'SKU',name:'Hàng',unit:'Kg',cost_price:100}],branch_stock:[{id:'s',branch_id:'w',variant_id:null,product_id:'p',quantity:0}]};});
const order=(id:string,customer='nb')=>({id,code:id,tenant_id:'tenant',source:'order',status:'draft',fulfilled_by_id:null,deleted_at:null,branch_id:'w',customer_id:customer,branches:{name:'Kho tổng'}});
const line=(id:string,invoice:string,quantity=1)=>({id,invoice_id:invoice,product_id:'p',quantity,total:100*quantity});
describe('forecast complete reads',()=>{
 it('reads 1201 orders and every item, beyond server row limits',async()=>{
  f.tables.invoices=Array.from({length:1201},(_,i)=>order(`o${i}`));f.tables.invoice_items_scoped=f.tables.invoices.map((o,i)=>line(`i${i}`,String(o.id)));
  const r=await getPurchaseForecast({},'w');expect(r.orderCount).toBe(1201);expect(r.skuRows[0].remainingQuantity).toBe(1201);expect(r.materials[0].required).toBe(1201);
 });
 it('keeps customer and warehouse filters and subtracts only valid issued lines',async()=>{
  f.tables.invoices=[order('a'),order('b','other'),{id:'c',tenant_id:'tenant',source:'pos',source_order_id:'a',status:'completed',deleted_at:null,voided_at:null,cancelled_at:null}];
  f.tables.invoice_items_scoped=[line('ia','a',10),line('ib','b',50),line('ic','c',3)];
  const r=await getPurchaseForecast({customerId:'nb'},'w');expect(r.orderCount).toBe(1);expect(r.skuRows[0]).toMatchObject({orderedQuantity:10,issuedQuantity:3,remainingQuantity:7});
 });
 it('filters groups and includes internal customers without using the normal customer-list exclusion',async()=>{
  f.tables.customers=[{id:'nb',tenant_id:'tenant',group_id:'g',is_internal:true}];f.tables.invoices=[order('a'),order('b','other')];f.tables.invoice_items_scoped=[line('ia','a'),line('ib','b',20)];
  const r=await getPurchaseForecast({customerGroupId:'g'},'w');expect(r.orderCount).toBe(1);expect(r.skuRows[0].remainingQuantity).toBe(1);
 });
 it('fails visibly on receipt, stock or BOM read errors instead of reporting incorrect zeroes',async()=>{
  f.tables.invoices=[order('a')];f.tables.invoice_items_scoped=[line('ia','a')];
  for(const table of ['invoice_items_scoped','bom_scoped','branch_stock']){f.fail=table;await expect(getPurchaseForecast({},'w')).rejects.toThrow('Synthetic read failed');}
 });
});
