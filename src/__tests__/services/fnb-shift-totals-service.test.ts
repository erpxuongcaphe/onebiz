import {beforeEach,describe,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),tenant:vi.fn()}));
vi.mock("@/lib/services/supabase/base",()=>({getClient:()=>({rpc:api.rpc,from:api.from}),getCurrentTenantId:api.tenant,handleError:(e:any)=>{throw new Error(e.message);}}));
import {closeShift,reconcilePendingShift} from "@/lib/services/supabase/shifts";
const totals={actualTransfer:500,expectedCash:300,expectedTransfer:500,closeKind:"end_of_day" as const};
const result={cash_in:200,cash_out:0,shift:{id:"s",tenant_id:"t",branch_id:"b",cashier_id:"u",status:"closed",starting_cash:100,expected_cash:300,actual_cash:300,cash_difference:0,total_sales:700,total_orders:2,sales_by_method:{cash:200,transfer:500},close_kind:"end_of_day",expected_transfer:500,actual_transfer:500,transfer_difference:0}};
beforeEach(()=>{vi.clearAllMocks();api.tenant.mockResolvedValue("t");api.rpc.mockResolvedValue({data:result,error:null});});
describe("F&B atomic shift reconciliation service",()=>{
 it("commits both counts and preview totals through one guarded RPC and uses its snapshot",async()=>{
  const saved=await closeShift({shiftId:"s",actualCash:300,reconciliation:totals});
  expect(api.rpc).toHaveBeenCalledWith("fnb_reconcile_shift_totals_20261022",{p_shift_id:"s",p_actual_cash:300,p_actual_transfer:500,p_expected_cash:300,p_expected_transfer:500,p_close_kind:"end_of_day",p_note:null,p_reason:null});
  expect(saved).toMatchObject({actualCash:300,actualTransfer:500,expectedTransfer:500,transferDifference:0,closeKind:"end_of_day"});
  expect(api.from).not.toHaveBeenCalled();
 });
 it("passes the manager's late-close reason without changing a pending shift back to open",async()=>{
  await reconcilePendingShift({shiftId:"s",actualCash:300,reconciliation:totals,reason:"Quên đóng ca"});
  expect(api.rpc).toHaveBeenCalledWith("fnb_reconcile_shift_totals_20261022",expect.objectContaining({p_reason:"Quên đóng ca"}));expect(api.from).not.toHaveBeenCalled();
 });
 it("does not fall back to a cash-only close when the new RPC is missing",async()=>{
  api.rpc.mockResolvedValue({data:null,error:{code:"PGRST202",message:"missing"}});
  await expect(closeShift({shiftId:"s",actualCash:300,reconciliation:totals})).rejects.toThrow("Chưa cập nhật chức năng đối soát ca");
  expect(api.rpc).toHaveBeenCalledTimes(1);
 });
 it("returns an actionable stale-preview error",async()=>{
  api.rpc.mockResolvedValue({data:null,error:{code:"PT409",message:"SHIFT_TOTALS_CHANGED"}});
  await expect(closeShift({shiftId:"s",actualCash:300,reconciliation:totals})).rejects.toThrow("ca chưa được chốt");expect(api.from).not.toHaveBeenCalled();
 });
});
