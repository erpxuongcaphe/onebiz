import { beforeEach, describe, expect, it, vi } from "vitest";
const api=vi.hoisted(()=>({rpc:vi.fn(),locked:vi.fn()}));
vi.mock("@/lib/services/supabase/base",()=>({getClient:()=>({rpc:api.rpc}),getCurrentContext:vi.fn(),handleError:(e:Error)=>{throw e}}));
vi.mock("@/lib/services/supabase/tenant-settings",()=>({isInventoryLocked:api.locked}));
import {adjustStockToValue} from "@/lib/services/supabase/stock-adjustments";
const input={requestId:"request-1",productId:"product",branchId:"branch",currentQty:10,newQty:8,reason:"  Đối soát chênh lệch  "};
beforeEach(()=>{vi.resetAllMocks();api.locked.mockResolvedValue(false);api.rpc.mockResolvedValue({data:{success:true},error:null})});
describe("target stock adjustment",()=>{
 it("sends an absolute target, expected balance and stable request ID to the transactional guard",async()=>{
  await adjustStockToValue(input);await adjustStockToValue(input);
  expect(api.rpc).toHaveBeenCalledTimes(2);
  for(const [name,payload] of api.rpc.mock.calls){
   expect(name).toBe("adjust_stock_to_value_atomic");
   expect(payload).toEqual({p_request_id:"request-1",p_branch_id:"branch",p_product_id:"product",p_expected_quantity:10,p_new_quantity:8,p_reason:"Đối soát chênh lệch"});
  }
 });
 it("never writes when inventory is locked",async()=>{
  api.locked.mockResolvedValue(true);await expect(adjustStockToValue(input)).rejects.toThrow("đang khóa");
  expect(api.rpc).not.toHaveBeenCalled();
 });
 it.each([
  ["STOCK_TARGET_CHANGED","Tồn kho đã thay đổi"],
  ["STOCK_TARGET_REQUEST_REUSED","đã được ghi nhận"],
  ["STOCK_TARGET_VARIANT_REQUIRES_CHECK","biến thể"],
  ["FNB_BRANCH_COST_REQUIRED","giá vốn"],
  ["FNB_MANUAL_STOCK_GAIN_COST_REQUIRED","giá vốn"],
 ])("explains %s without retrying a legacy mutation",async(message,expected)=>{
  api.rpc.mockResolvedValue({error:{message}});
  await expect(adjustStockToValue(input)).rejects.toThrow(expected);
  expect(api.rpc).toHaveBeenCalledTimes(1);
 });
});
