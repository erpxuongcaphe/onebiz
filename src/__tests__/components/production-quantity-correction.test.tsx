import React from "react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { CorrectProductionOrderDialog } from "@/components/shared/dialogs/correct-production-order-dialog";
import type { ProductionOrder } from "@/lib/types";
const mocks=vi.hoisted(()=>({detail:vi.fn(),correct:vi.fn(),preview:vi.fn(),apply:vi.fn(),toast:vi.fn()}));
vi.mock("@/lib/services/supabase/production",()=>({getProductionOrderById:mocks.detail,correctProductionOrderQuantities:mocks.correct,previewProductionUsedAdjustment:mocks.preview,applyProductionUsedAdjustment:mocks.apply}));
vi.mock("@/lib/contexts",()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock("@/lib/hooks/use-product-uom",()=>({useProductUom:()=>({loading:false,error:"",units:new Map([["cream","G"],["rich","Hộp"]]),map:new Map([["rich",[{fromUnit:"Hộp",toUnit:"G",factor:907,isActive:true}]]])})}));
vi.mock("@/components/ui/dialog",()=>({
 Dialog:({children}:{children:React.ReactNode})=><>{children}</>,DialogContent:({children}:{children:React.ReactNode})=><div role="dialog">{children}</div>,
 DialogHeader:({children}:{children:React.ReactNode})=><div>{children}</div>,DialogFooter:({children}:{children:React.ReactNode})=><div>{children}</div>,
 DialogTitle:({children}:{children:React.ReactNode})=><h2>{children}</h2>,DialogDescription:({children}:{children:React.ReactNode})=><p>{children}</p>,
}));
const order={id:"cream-order",code:"SX000047",status:"completed",productId:"cream",productName:"Kem Sữa",branchName:"Quán",completedQty:585,plannedQty:580,updatedAt:"2026-10-14T09:50:32Z",
 materials:[{productId:"rich",productName:"Rich",unit:"Hộp",plannedQty:3.441,actualQty:3.441}]} as ProductionOrder;
const plan={token:"preview-exact",orderCode:order.code,productName:"Kem Sữa",unit:"G",outputBefore:585,outputAfter:500,usedQuantity:200,remainingBefore:385,remainingAfter:300,stockBefore:1000,stockAfter:915,stockDelta:-85,
 batchCostBefore:40000,batchCostAfter:30000,inventoryCostDelta:-6000,usedCostDelta:-4000,materials:[{productId:"rich",productName:"Rich",unit:"Hộp",before:3.441,after:.441,stockBefore:2,stockAfter:5,stockDelta:3,costDelta:10000}]};
beforeEach(()=>{vi.clearAllMocks();mocks.detail.mockResolvedValue(order);mocks.correct.mockResolvedValue({});mocks.preview.mockResolvedValue(plan);mocks.apply.mockResolvedValue({id:"saved"});});
afterEach(cleanup);
async function reason(){fireEvent.change(await screen.findByPlaceholderText("Ví dụ: nhập nhầm lượng Rich ONTOP"),{target:{value:"Nhập nhầm"}});}
describe("production correction workflow",()=>{
 it("previews converted quantities and requires a separate confirmation before changing used stock",async()=>{
   render(<CorrectProductionOrderDialog order={order} onClose={vi.fn()} onSuccess={vi.fn()} />);
   const quantity=await screen.findByLabelText("Thực dùng Rich");
   expect(screen.getByRole("button",{name:"Xem trước chênh lệch"})).toBeDisabled();
   fireEvent.change(screen.getByLabelText("Đơn vị Thực dùng Rich"),{target:{value:"G"}});fireEvent.change(quantity,{target:{value:"400"}});await reason();
   fireEvent.click(screen.getByRole("button",{name:"Xem trước chênh lệch"}));
   await screen.findByRole("button",{name:"Xác nhận điều chỉnh kho"});
   expect(mocks.apply).not.toHaveBeenCalled();expect(mocks.correct).not.toHaveBeenCalled();
   expect(mocks.preview.mock.calls[0][0]).toMatchObject({expectedUpdatedAt:order.updatedAt,outputQuantity:585,materials:[{quantity:400,unit:"G",expectedFactor:expect.any(Number)}]});
   fireEvent.click(screen.getByRole("button",{name:"Xác nhận điều chỉnh kho"}));await waitFor(()=>expect(mocks.apply).toHaveBeenCalledOnce());
   expect(mocks.apply.mock.calls[0][0]).toMatchObject({previewToken:"preview-exact",expectedUpdatedAt:order.updatedAt,reason:"Nhập nhầm",requestId:expect.stringMatching(/^[0-9a-f-]{36}$/)});
 });
 it("preserves entered quantities when preview fails without attempting a write",async()=>{
   mocks.preview.mockRejectedValue(new Error("Sổ lô cần đối soát"));render(<CorrectProductionOrderDialog order={order} onClose={vi.fn()} onSuccess={vi.fn()} />);
   const quantity=await screen.findByLabelText("Thực dùng Rich");fireEvent.change(quantity,{target:{value:"0.441"}});await reason();
   fireEvent.click(screen.getByRole("button",{name:"Xem trước chênh lệch"}));expect(await screen.findByRole("alert")).toHaveTextContent("Sổ lô cần đối soát");
   expect(quantity).toHaveValue(.441);expect(mocks.apply).not.toHaveBeenCalled();
 });
 it("invalidates the old preview when returning to edit",async()=>{
   render(<CorrectProductionOrderDialog order={order} onClose={vi.fn()} onSuccess={vi.fn()} />);await reason();fireEvent.click(screen.getByRole("button",{name:"Xem trước chênh lệch"}));
   fireEvent.click(await screen.findByRole("button",{name:"Quay lại / Xem trước lại"}));
   fireEvent.change(screen.getByLabelText(/Tổng thành phẩm đúng/),{target:{value:"600"}});
   expect(screen.queryByRole("button",{name:"Xác nhận điều chỉnh kho"})).not.toBeInTheDocument();
   fireEvent.click(screen.getByRole("button",{name:"Xem trước chênh lệch"}));await waitFor(()=>expect(mocks.preview).toHaveBeenCalledTimes(2));expect(mocks.preview.mock.calls[1][0].outputQuantity).toBe(600);
 });
 it("reuses the same request ID after an uncertain save, preventing duplicate adjustments",async()=>{
   mocks.apply.mockRejectedValueOnce(new Error("Mất kết nối"));render(<CorrectProductionOrderDialog order={order} onClose={vi.fn()} onSuccess={vi.fn()} />);await reason();
   fireEvent.click(screen.getByRole("button",{name:"Xem trước chênh lệch"}));fireEvent.click(await screen.findByRole("button",{name:"Xác nhận điều chỉnh kho"}));await screen.findByRole("alert");
   fireEvent.click(screen.getByRole("button",{name:"Xác nhận điều chỉnh kho"}));await waitFor(()=>expect(mocks.apply).toHaveBeenCalledTimes(2));expect(mocks.apply.mock.calls[0][0].requestId).toBe(mocks.apply.mock.calls[1][0].requestId);
 });
 it("keeps planned-order editing on the existing route",async()=>{
   mocks.detail.mockResolvedValue({...order,status:"planned"});render(<CorrectProductionOrderDialog order={{...order,status:"planned"}} onClose={vi.fn()} onSuccess={vi.fn()} />);await reason();
   fireEvent.click(screen.getByRole("button",{name:"Lưu điều chỉnh"}));await waitFor(()=>expect(mocks.correct).toHaveBeenCalledOnce());expect(mocks.preview).not.toHaveBeenCalled();
 });
 it("cancels through the existing guarded flow with no replacement recipe",async()=>{
   render(<CorrectProductionOrderDialog order={order} cancel onClose={vi.fn()} onSuccess={vi.fn()} />);await screen.findByText("Nguyên liệu hoàn lại");await reason();
   fireEvent.click(screen.getByRole("button",{name:"Hủy & hoàn kho"}));await waitFor(()=>expect(mocks.correct).toHaveBeenCalledOnce());
   expect(mocks.correct.mock.calls[0][0]).toMatchObject({orderId:order.id,cancel:true,outputQuantity:0,materials:[],reason:"Nhập nhầm"});expect(mocks.apply).not.toHaveBeenCalled();
 });
});
