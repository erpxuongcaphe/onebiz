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
 it('reports server errors without falling back to unlinked PO creation',async()=>{
  mocks.rpc.mockResolvedValue({error:new Error('server rollback')});await expect(submitWarehouseOrder(input)).rejects.toThrow('server rollback');expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
});
