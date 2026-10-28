import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({queries:[] as any[],rows:[] as any[],error:null as any}));
vi.mock('@/lib/services/supabase/base',()=>({getCurrentContext:async()=>({tenantId:'tenant'}),handleError:(e:any)=>{throw Error(e.message);},getClient:()=>({from:()=>{
 let rows=[...m.rows];const q:any={select:vi.fn(()=>q),eq:vi.fn((k,v)=>{rows=rows.filter(p=>p[k]===v);return q;}),not:vi.fn((k,_op,v)=>{rows=rows.filter(p=>!String(p[k]??'').toLowerCase().startsWith(v.slice(0,-1).toLowerCase()));return q;}),or:vi.fn(()=>{rows=rows.filter(p=>p.inventory_role!=='fnb_menu_item');return q;}),ilike:vi.fn((k,v)=>{rows=rows.filter(p=>String(p[k]).toLowerCase().includes(v.slice(1,-1).replace(/\\(.)/g,'$1').toLowerCase()));return q;}),order:()=>q,limit:async(n:number)=>({data:rows.slice(0,n),error:m.error})};m.queries.push(q);return q;
}})}));
import {searchSupplierPurchaseProducts} from '@/lib/services/supabase/supplier-purchase-products';
const row=(code:string,extra={})=>({id:code,code,name:'Sữa nguyên liệu',unit:'Hộp',cost_price:20,vat_rate:0,tenant_id:'tenant',is_active:true,product_type:'sku',inventory_role:null,...extra});
beforeEach(()=>{m.rows=[];m.queries=[];m.error=null;});
describe('supplier purchase SKU search',()=>{
 it('finds SKU by code, deduplicates name/code hits and filters wholesale/NVL/menu before limit',async()=>{
  m.rows=[...Array.from({length:22},(_,i)=>row(`WS-${i}`)),row('SKU-SUA-001'),row('NVL-001',{product_type:'nvl'}),row('SKU-MENU',{inventory_role:'fnb_menu_item'}),row('SKU-FECA',{name:'FECA coffee'}),row('SKU-OTHER',{tenant_id:'other'}),row('SKU-OFF',{is_active:false})];
  expect((await searchSupplierPurchaseProducts('SKU-SUA-001',true)).map(p=>p.code)).toEqual(['SKU-SUA-001']);
  expect((await searchSupplierPurchaseProducts('Sữa',true)).map(p=>p.code)).toEqual(['SKU-SUA-001']);
 });
 it('keeps retail NVL and explicit document branch scope separate',async()=>{
  m.rows=[row('SKU-1'),row('NVL-1',{product_type:'nvl'})];
  expect((await searchSupplierPurchaseProducts('Sữa',false)).map(p=>p.code)).toEqual(['NVL-1']);
 });
 it('searches punctuation literally and reports network failures',async()=>{
  m.rows=[row('SKU-1',{name:'Syrup (Đào), 100%'})];
  expect(await searchSupplierPurchaseProducts('(Đào), 100%',true)).toHaveLength(1);
  expect(m.queries[0].or).toHaveBeenCalledWith('inventory_role.is.null,inventory_role.neq.fnb_menu_item');
  m.error={message:'offline'};await expect(searchSupplierPurchaseProducts('SKU',true)).rejects.toThrow('offline');
 });
 it('does not query on blank input',async()=>{expect(await searchSupplierPurchaseProducts(' ',true)).toEqual([]);expect(m.queries).toHaveLength(0);});
});

