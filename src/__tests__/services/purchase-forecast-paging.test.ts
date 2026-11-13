import {beforeEach,describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({tables:{} as Record<string,Record<string,unknown>[]>,fail:'',batches:[] as number[],headerCalls:[] as unknown[],calls:[] as {table:string;filters:unknown[][];offset:number}[]}));
vi.mock('@/lib/services/supabase/base',()=>({getCurrentTenantId:async()=> 'tenant',getClient:()=>({rpc:async(fn:string,args?:{p_order_ids?:string[];p_branch?:string|null;p_customer_ids?:string[]|null;p_offset?:number;p_limit?:number})=>{
 if(fn==='get_purchase_forecast_order_headers'){
  f.headerCalls.push(args);
  if(f.fail==='headers_rpc')return {data:null,error:{message:'Synthetic read failed'}};
  if(f.fail==='headers_malformed')return {data:{items:[],total:null},error:null};
  const rows=(f.tables.invoices??[]).filter(o=>o.source==='order'&&['draft','confirmed','delivering'].includes(String(o.status))&&!o.deleted_at&&!o.fulfilled_by_id&&
   !((o.active_processing as {closed_at?:string|null}|null)?.closed_at)&&(!args?.p_branch||o.branch_id===args.p_branch)&&
   (!args?.p_customer_ids||args.p_customer_ids.includes(String(o.customer_id))));
  const offset=args?.p_offset??0,size=args?.p_limit??200;
  return {data:{items:rows.slice(offset,offset+size).map(o=>({id:o.id,branch_id:o.branch_id,branches:o.branches})),total:rows.length},error:null};
 }
 if(fn!=='get_purchase_forecast_remaining_lines')return {data:[],error:null};
 if(f.fail==='forecast_rpc')return {data:null,error:{message:'Synthetic read failed'}};
 if(f.fail==='forecast_denied')return {data:null,error:{message:'PURCHASE_FORECAST_CHILD_SCOPE_REQUIRED'}};
 if(f.fail==='forecast_malformed')return {data:[{orderId:'unknown',productId:'p',orderedQuantity:1,issuedQuantity:0,remainingQuantity:1,remainingAmount:100}],error:null};
 const ids=args?.p_order_ids??[];
 f.batches.push(ids.length);
 const rows=f.tables.invoice_items_scoped??[];
 const children=(f.tables.invoices??[]).filter(c=>ids.includes(String(c.source_order_id))&&c.status==='completed'&&!c.deleted_at&&!c.voided_at&&!c.cancelled_at);
 const grouped=new Map<string,{orderId:string;productId:string;orderedQuantity:number;issuedQuantity:number;amount:number}>();
 for(const row of rows.filter(r=>ids.includes(String(r.invoice_id)))){const key=`${row.invoice_id}::${row.product_id}`;const current=grouped.get(key)??{orderId:String(row.invoice_id),productId:String(row.product_id),orderedQuantity:0,issuedQuantity:0,amount:0};current.orderedQuantity+=Number(row.quantity);current.amount+=Number(row.total);grouped.set(key,current);}
 for(const row of rows){const child=children.find(c=>c.id===row.invoice_id);if(!child)continue;const current=grouped.get(`${child.source_order_id}::${row.product_id}`);if(current)current.issuedQuantity+=Number(row.quantity);}
 return {data:[...grouped.values()].map(x=>({...x,remainingQuantity:Math.max(0,x.orderedQuantity-x.issuedQuantity),remainingAmount:x.orderedQuantity>0?x.amount*Math.max(0,x.orderedQuantity-x.issuedQuantity)/x.orderedQuantity:0})),error:null};
 },from:(table:string)=>{
 const state={table,filters:[] as unknown[][],offset:0,size:200};
 const q={select(){return q;},eq(k:string,v:unknown){state.filters.push(['eq',k,v]);return q;},in(k:string,v:unknown[]){state.filters.push(['in',k,v]);return q;},is(k:string,v:unknown){state.filters.push(['is',k,v]);return q;},not(k:string,operator:string,v:unknown){state.filters.push([`not.${operator}`,k,v]);return q;},gte(){return q;},lt(){return q;},order(){return q;},range(a:number,b:number){state.offset=a;state.size=b-a+1;return q;},then(resolve:(v:unknown)=>unknown){
  f.calls.push({...state,filters:[...state.filters]});
  const onlyActiveClosures = state.filters.some(([op,k,v])=>op==='not.is' && k==='active_processing.closed_at' && v===null);
  const rows=(f.tables[table]??[]).filter(r=>state.filters.every(([op,k,v])=>{
   if (k==='active_processing.closed_at') return true;
   if (k==='active_processing' && onlyActiveClosures) {
    return ((r.active_processing as {closed_at?:string|null}|null)?.closed_at ?? null)===v;
   }
   if (op==='in') return (v as unknown[]).includes(r[String(k)]);
   if (op==='is') return (r[String(k)]??null)===v;
   return r[String(k)]===v;
  }));
  return Promise.resolve({data:rows.slice(state.offset,state.offset+state.size),count:rows.length,error:f.fail===table?{message:'Synthetic read failed'}:null}).then(resolve);
 }};return q;}})}));
import {getPurchaseForecast} from '@/lib/services/supabase/purchase-forecast';
beforeEach(()=>{f.fail='';f.calls=[];f.batches=[];f.headerCalls=[];f.tables={branches:[{id:'w',name:'Kho tổng',tenant_id:'tenant',branch_type:'warehouse'}],products_scoped:[{id:'p',tenant_id:'tenant',code:'SKU',name:'Hàng',unit:'Kg',cost_price:100}],branch_stock:[{id:'s',branch_id:'w',variant_id:null,product_id:'p',quantity:0}]};});
const order=(id:string,customer='nb')=>({id,code:id,tenant_id:'tenant',source:'order',status:'draft',fulfilled_by_id:null,deleted_at:null,branch_id:'w',customer_id:customer,branches:{name:'Kho tổng'}});
const line=(id:string,invoice:string,quantity=1)=>({id,invoice_id:invoice,product_id:'p',quantity,total:100*quantity});
describe('forecast complete reads',()=>{
 it('reads 1201 orders and every item, beyond server row limits',async()=>{
  f.tables.invoices=Array.from({length:1201},(_,i)=>order(`o${i}`));f.tables.invoice_items_scoped=f.tables.invoices.map((o,i)=>line(`i${i}`,String(o.id)));
  const r=await getPurchaseForecast({},'w');expect(r.orderCount).toBe(1201);expect(r.skuRows[0].remainingQuantity).toBe(1201);expect(r.materials[0].required).toBe(1201);
  expect(f.batches).toHaveLength(13);expect(Math.max(...f.batches)).toBe(100);
 });
 it('keeps customer and warehouse filters and subtracts only valid issued lines',async()=>{
  f.tables.invoices=[order('a'),order('b','other'),{id:'c',tenant_id:'tenant',source:'pos',source_order_id:'a',status:'completed',deleted_at:null,voided_at:null,cancelled_at:null}];
  f.tables.invoice_items_scoped=[line('ia','a',10),line('ib','b',50),line('ic','c',3)];
  const r=await getPurchaseForecast({customerId:'nb'},'w');expect(r.orderCount).toBe(1);expect(r.skuRows[0]).toMatchObject({orderedQuantity:10,issuedQuantity:3,remainingQuantity:7});
 });
 it('passes branch, customer and Vietnam day boundaries to the guarded header reader',async()=>{
  f.tables.invoices=[order('a')];f.tables.invoice_items_scoped=[line('ia','a')];
  await getPurchaseForecast({dateFrom:'2026-07-01',dateTo:'2026-07-04',customerId:'nb'},'w');
  expect(f.headerCalls[0]).toMatchObject({p_branch:'w',p_customer_ids:['nb'],p_from:'2026-06-30T17:00:00.000Z',p_to:'2026-07-04T17:00:00.000Z'});
 });
 it('excludes processed orders and counts only the undelivered quantity of a reopened order',async()=>{
  f.tables.invoices=[
   {...order('DH000157'),active_processing:{closed_at:'2026-11-09T04:18:21Z'}},
   {...order('DH000159'),active_processing:{closed_at:'2026-11-09T04:19:06Z'}},
   {...order('reopened'),active_processing:{closed_at:null}},
   {id:'issued',tenant_id:'tenant',source_order_id:'reopened',status:'completed'},
  ];
  f.tables.invoice_items_scoped=[line('a','DH000157',48),line('b','DH000159',48),line('c','reopened',10),line('d','issued',3)];
  const r=await getPurchaseForecast({},'w');
  expect(r.orderCount).toBe(1);
  expect(r.skuRows[0]).toMatchObject({orderedQuantity:10,issuedQuantity:3,remainingQuantity:7});
  expect(r.materials[0].required).toBe(7);
 });
 it('filters groups and includes internal customers without using the normal customer-list exclusion',async()=>{
  f.tables.customers=[{id:'nb',tenant_id:'tenant',group_id:'g',is_internal:true}];f.tables.invoices=[order('a'),order('b','other')];f.tables.invoice_items_scoped=[line('ia','a'),line('ib','b',20)];
  const r=await getPurchaseForecast({customerGroupId:'g'},'w');expect(r.orderCount).toBe(1);expect(r.skuRows[0].remainingQuantity).toBe(1);
 });
 it('fails visibly on receipt, stock or BOM read errors instead of reporting incorrect zeroes',async()=>{
  f.tables.invoices=[order('a')];f.tables.invoice_items_scoped=[line('ia','a')];
  for(const table of ['headers_rpc','forecast_rpc','bom_scoped','branch_stock']){f.fail=table;await expect(getPurchaseForecast({},'w')).rejects.toThrow('Synthetic read failed');}
 });
 it('rejects incomplete or out-of-scope forecast results rather than showing misleading totals',async()=>{
  f.tables.invoices=[order('a')];f.tables.invoice_items_scoped=[line('ia','a')];
  f.fail='forecast_malformed';await expect(getPurchaseForecast({},'w')).rejects.toThrow('không hợp lệ');
  f.fail='forecast_denied';await expect(getPurchaseForecast({},'w')).rejects.toThrow('chưa được phép xem');
  f.fail='headers_malformed';await expect(getPurchaseForecast({},'w')).rejects.toThrow('không hợp lệ');
 });
});
