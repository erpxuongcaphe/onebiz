import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({rpc}), getCurrentTenantId: vi.fn(), handleError: vi.fn() }));
import { correctProductionOrderQuantities } from "@/lib/services/supabase/production";
const input = {orderId:"order",expectedUpdatedAt:"2026-10-23T01:00:00Z",requestId:"request",outputQuantity:0,materials:[],reason:" Sai món ",cancel:true};
beforeEach(() => rpc.mockReset());
describe("production correction lot errors", () => {
  it.each([
    ["PRODUCTION_CORRECTION_OUTPUT_USED", "chính mẻ này"],
    ["PRODUCTION_CORRECTION_LOT_RECONCILIATION_REQUIRED", "Sổ lô"],
  ])("explains %s without retrying or writing status separately", async (message, expected) => {
    rpc.mockResolvedValue({data:null,error:{message}});
    await expect(correctProductionOrderQuantities(input)).rejects.toThrow(expected);
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("keeps atomic cancellation payload/version/request and trims the reason", async () => {
    rpc.mockResolvedValue({data:{status:"cancelled"},error:null});
    await expect(correctProductionOrderQuantities(input)).resolves.toEqual({status:"cancelled"});
    expect(rpc).toHaveBeenCalledWith("correct_production_order_quantities",{p_order_id:"order",p_expected_updated_at:input.expectedUpdatedAt,p_request_id:"request",p_output_quantity:0,p_materials:[],p_reason:"Sai món",p_cancel:true});
  });
});
