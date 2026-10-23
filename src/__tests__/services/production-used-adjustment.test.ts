import {beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/lib/services/supabase/base",()=>({getClient:()=>({rpc:mock.rpc}),getCurrentTenantId:vi.fn(),handleError:vi.fn()}));
import {previewProductionUsedAdjustment,applyProductionUsedAdjustment} from "@/lib/services/supabase/production";
const input={orderId:"order",expectedUpdatedAt:"2026-10-23T06:00:00Z",outputQuantity:800,materials:[{productId:"raw",quantity:.2,unit:"Túi",expectedFactor:1}],reason:"  Nhập nhầm  "};
beforeEach(()=>vi.clearAllMocks());
describe("used batch service boundaries",()=>{
 it("passes original version, measured units and reason to read-only preview",async()=>{
  mock.rpc.mockResolvedValue({data:{token:"quoted"},error:null});await previewProductionUsedAdjustment(input);
  expect(mock.rpc).toHaveBeenCalledWith("preview_production_used_adjustment",{p_order_id:"order",p_expected_updated_at:input.expectedUpdatedAt,p_output_quantity:800,p_materials:input.materials,p_reason:"Nhập nhầm"});
 });
 it("sends the preview token and stable request to apply once with no fallback",async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{message:"PRODUCTION_ADJUSTMENT_PREVIEW_STALE"}});
  await expect(applyProductionUsedAdjustment({...input,requestId:"request",previewToken:"quoted"})).rejects.toThrow("Xem trước lại");expect(mock.rpc).toHaveBeenCalledOnce();
  expect(mock.rpc.mock.calls[0][1]).toMatchObject({p_request_id:"request",p_preview_token:"quoted"});
 });
 it("rejects incomplete preview responses",async()=>{mock.rpc.mockResolvedValue({data:{},error:null});await expect(previewProductionUsedAdjustment(input)).rejects.toThrow("hợp lệ");});
 it("explains that output cannot be less than already used without guessing a stock repair",async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{message:"PRODUCTION_ADJUSTMENT_BELOW_USED"}});await expect(previewProductionUsedAdjustment(input)).rejects.toThrow("nhỏ hơn lượng đã dùng");
 });
});
