import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>({rpc:mocks.rpc}),handleError:(e:Error)=>{throw e;}}));
import { getWarehouseOrderContext, submitWarehouseOrder } from '@/lib/services/supabase/fnb-warehouse-orders';
const input={branchId:'store',warehouseId:'warehouse',requestId:'durable-key',items:[{productId:'milk',quantity:3}],note:'  Giữ nguyên ghi chú\nHàng mới  '};
describe('warehouse order bridge client',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('sends branch context and literal search to scoped server RPC',async()=>{
  mocks.rpc.mockResolvedValue({data:{warehouses:[],products:[]}});await getWarehouseOrderContext('store',"%'_");
  expect(mocks.rpc).toHaveBeenCalledWith('get_fnb_warehouse_order_context',{p_branch_id:'store',p_search:"%'_"});
 });
 it('sends only quantities and durable key; pricing remains on server',async()=>{
  mocks.rpc.mockResolvedValue({data:{purchaseOrderId:'po',code:'PO1',salesOrderId:'order',salesOrderCode:'DH1'}});
  await submitWarehouseOrder(input);
  expect(mocks.rpc).toHaveBeenCalledWith('submit_fnb_warehouse_order',{p_branch_id:'store',p_warehouse_id:'warehouse',p_request_id:'durable-key',p_items:input.items,p_note:input.note});
 });
 it.each([0,-1,NaN,Infinity])('rejects invalid client quantity %s',async quantity=>{
  await expect(submitWarehouseOrder({...input,items:[{productId:'milk',quantity}]})).rejects.toThrow('số lượng');expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('does not treat an incomplete response as success',async()=>{
  mocks.rpc.mockResolvedValue({data:{code:'PO1'}});await expect(submitWarehouseOrder(input)).rejects.toThrow('Chưa nhận được xác nhận');
 });
 it('keeps literal notes per SKU separate from the document note',async()=>{
  mocks.rpc.mockResolvedValue({data:{purchaseOrderId:'po',code:'PO1',salesOrderId:'order',salesOrderCode:'DH1'}});
  const items=[{productId:'milk',quantity:3,note:'  Nguyên thùng\nGiữ lạnh  '},{productId:'tea',quantity:2,note:'Trà mới'}];
  await submitWarehouseOrder({...input,items});
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({p_items:items,p_note:input.note});
 });
 it('rejects oversized line notes before calling the backend',async()=>{
  await expect(submitWarehouseOrder({...input,items:[{productId:'milk',quantity:1,note:'x'.repeat(2001)}]})).rejects.toThrow('2000');
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('reports server errors without falling back to unlinked PO creation',async()=>{
  mocks.rpc.mockResolvedValue({error:new Error('server rollback')});await expect(submitWarehouseOrder(input)).rejects.toThrow('server rollback');expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it('explains an unavailable backend without exposing SQL/RPC internals',async()=>{
  mocks.rpc.mockResolvedValue({error:{code:'PGRST202',message:'Could not find function public.get_fnb_warehouse_order_context'}});
  await expect(getWarehouseOrderContext('store')).rejects.toThrow('Chức năng đặt kho tổng chưa được bật');
  await expect(submitWarehouseOrder(input)).rejects.toThrow('Chức năng đặt kho tổng chưa được bật');
 });
});
