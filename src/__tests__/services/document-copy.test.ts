import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({rows:{} as Record<string,unknown>,calls:[] as Array<[string,string,unknown]>,from:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getCurrentContext:async()=>({tenantId:'tenant'}),getClient:()=>({from:state.from}),handleError:(e:Error)=>{throw e;}}));
import {loadDocumentCopy} from '@/lib/services/supabase/document-copy';
beforeEach(()=>{
 state.calls=[];state.rows={purchase_orders:{id:'old',code:'PO001',branch_id:'branch',supplier_id:'supplier',note:'Giao sáng'},purchase_order_items:[{product_id:'milk',quantity:2,unit:'Hộp',unit_price:30,discount:4,vat_rate:0,note:'Lô mới'}],products_scoped:[{id:'milk',code:'SKU-SUA',name:'Sữa',unit:'Hộp',cost_price:25,is_active:true,product_type:'sku',inventory_role:'retail_stock_item'}],suppliers:{id:'supplier',name:'Kho tổng',branch_id:'warehouse',is_active:true},inventory_checks:{id:'check',code:'KK001'},inventory_check_items:[{product_id:'milk'}]};
 state.from.mockImplementation((table:string)=>{const q={select:vi.fn(()=>q),eq:vi.fn((column:string,value:unknown)=>{state.calls.push([table,column,value]);return q;}),in:vi.fn(()=>q),order:vi.fn(()=>q),limit:vi.fn(()=>q),single:vi.fn(async()=>({data:state.rows[table],error:null})),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:state.rows[table],error:null}).then(resolve)};return q;});
});
describe('read-only document templates',()=>{
 it('loads source in the selected tenant and branch without creating stock/payment documents',async()=>{
  const result=await loadDocumentCopy('purchase','old','branch',true);
  expect(state.calls).toContainEqual(['purchase_orders','tenant_id','tenant']);expect(state.calls).toContainEqual(['purchase_orders','branch_id','branch']);
  expect(result.items[0]).toMatchObject({id:'milk',quantity:2,price:28,note:'Lô mới'});
  expect(result).not.toHaveProperty('requestId');expect(result).not.toHaveProperty('paid');expect(result).not.toHaveProperty('status');
 });
 it.each([['WS-001','Sữa'],['SKU-CPH-001','WS - Xưởng Đặc Biệt'],['SKU-CPH-022','FECA - Đặc Biệt']])('rejects wholesale-only copy lines %s before showing a partial copy',async(code,name)=>{
  (state.rows.products_scoped as Array<Record<string,unknown>>)[0]={...(state.rows.products_scoped as Array<Record<string,unknown>>)[0],code,name};
  await expect(loadDocumentCopy('purchase','old','branch',true)).rejects.toThrow('không thuộc danh mục');
  expect((await loadDocumentCopy('purchase','old','branch',false)).items).toHaveLength(1);
 });
 it('does not reuse previous actual counts when copying an inventory list',async()=>{
  const seed=await loadDocumentCopy('inventory','check','branch',true);expect(seed.items[0]).not.toHaveProperty('actualStock');expect(seed.supplier).toBeNull();
 });
 it('fails closed on missing/inactive products and changed stock units',async()=>{
  state.rows.products_scoped=[];await expect(loadDocumentCopy('purchase','old','branch',true)).rejects.toThrow('Chưa sao chép');
 });
 it('rejects changed units instead of guessing a conversion',async()=>{
  (state.rows.purchase_order_items as Array<Record<string,unknown>>)[0].unit='Thùng';await expect(loadDocumentCopy('purchase','old','branch',true)).rejects.toThrow('Đơn vị tồn');
 });
});
