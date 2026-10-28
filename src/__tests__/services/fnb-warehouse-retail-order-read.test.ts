import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({from:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>({from:mocks.from}),getCurrentTenantId:async()=> 'tenant',getCurrentContext:vi.fn(),getPaginationRange:()=>({from:0,to:49}),handleError:(e:Error)=>{throw e;}}));
vi.mock('@/lib/services/supabase/pos-checkout',()=>({posCheckout:vi.fn()}));
vi.mock('@/lib/services/supabase/audit',()=>({recordAuditLog:vi.fn()}));
import { getDraftOrderItems, getOrders } from '@/lib/services/supabase/orders';
function query(result:unknown){
 const q:Record<string,unknown>={then:(resolve:(v:unknown)=>void)=>Promise.resolve(result).then(resolve)};
 for(const m of ['select','eq','in','is','not','or','order','range'])q[m]=vi.fn(()=>q);
 q.maybeSingle=vi.fn(async()=>result);
 return q as Record<string, ReturnType<typeof vi.fn>>;
}
describe('warehouse demand visible through both Retail order readers',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('Retail order list and POS processing reader include the same warehouse request and literal general note',async()=>{
  const order={id:'order',code:'DH1',branch_id:'warehouse',source:'order',status:'draft',note:'Giữ lạnh\nĐề nghị thêm mã mới',customer_name:'Chi nhánh A'};
  for(const processing of [false,true]){
   const main=query({data:[order],count:1});const children=query({data:[]});mocks.from.mockReturnValueOnce(main).mockReturnValueOnce(children);
   const result=await getOrders({page:0,pageSize:50,branchId:'warehouse',filters:processing?{fulfillmentState:'open',status:['draft','confirmed','delivering']}: {}});
   expect(main.eq).toHaveBeenCalledWith('tenant_id','tenant');expect(main.eq).toHaveBeenCalledWith('branch_id','warehouse');expect(main.eq).toHaveBeenCalledWith('source','order');
   expect(result.data[0]).toMatchObject({id:'order',code:'DH1',note:order.note});
   if(processing)expect(main.is).toHaveBeenCalledWith('fulfilled_by_id',null);
  }
 });
 it('detail returns every SKU, quantity and exact line note without merging into the general note',async()=>{
  const ownership=query({data:{id:'order'}});
  const lines=query({data:[{id:'a',products:{code:'SKU-A'},product_name:'Sữa A',quantity:2,note:'  Nguyên thùng\nHSD mới  '},{id:'b',products:{code:'SKU-B'},product_name:'Trà B',quantity:3,note:'Gói riêng'}]});
  mocks.from.mockReturnValueOnce(ownership).mockReturnValueOnce(lines);
  const result=await getDraftOrderItems('order');
  expect(ownership.eq).toHaveBeenCalledWith('tenant_id','tenant');
  expect(result).toMatchObject([{productCode:'SKU-A',quantity:2,note:'  Nguyên thùng\nHSD mới  '},{productCode:'SKU-B',quantity:3,note:'Gói riêng'}]);
 });
 it('does not read order lines when the parent is outside the readable tenant scope',async()=>{
  mocks.from.mockReturnValueOnce(query({data:null}));expect(await getDraftOrderItems('foreign')).toEqual([]);expect(mocks.from).toHaveBeenCalledTimes(1);
 });
 it('shows selected package quantities and prices from immutable snapshots',async()=>{
  mocks.from.mockReturnValueOnce(query({data:{id:'order'}})).mockReturnValueOnce(query({data:[{id:'milk',unit:'Lon',quantity:24,unit_price:10000,transaction_unit:'Thùng',transaction_quantity:2,transaction_unit_price:120000,total:240000}]}));
  expect(await getDraftOrderItems('order')).toMatchObject([{unit:'Thùng',quantity:2,unitPrice:120000,total:240000}]);
 });
 it('keeps all 120 requested rows and the last row note in the Retail detail',async()=>{
  const rows=Array.from({length:120},(_,i)=>({id:`row-${i}`,products:{code:`SKU-${i}`},product_name:`Mặt hàng ${i}`,quantity:i+1,note:`Ghi chú ${i}`}));
  mocks.from.mockReturnValueOnce(query({data:{id:'large-order'}})).mockReturnValueOnce(query({data:rows}));
  const result=await getDraftOrderItems('large-order');expect(result).toHaveLength(120);
  expect(result[119]).toMatchObject({productCode:'SKU-119',quantity:120,note:'Ghi chú 119'});
 });
});

vi.mock("@/lib/services/supabase/customer-identity",async importOriginal=>({
 ...await importOriginal<typeof import("@/lib/services/supabase/customer-identity")>(),
 getCustomerIdentityDirectory:async()=>[],
}));
