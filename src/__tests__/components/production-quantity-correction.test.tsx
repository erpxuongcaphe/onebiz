import React from "react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { CorrectProductionOrderDialog } from "@/components/shared/dialogs/correct-production-order-dialog";
import type { ProductionOrder } from "@/lib/types";
const mocks=vi.hoisted(()=>({detail:vi.fn(),correct:vi.fn(),toast:vi.fn()}));
vi.mock("@/lib/services",()=>({getProductionOrderById:mocks.detail,correctProductionOrderQuantities:mocks.correct}));
vi.mock("@/lib/contexts",()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock("@/lib/hooks/use-product-uom",()=>({useProductUom:()=>({loading:false,error:"",units:new Map([["cream","G"],["rich","Hộp"]]),map:new Map([["rich",[{fromUnit:"Hộp",toUnit:"G",factor:907,isActive:true}]]])})}));
vi.mock("@/components/ui/dialog",()=>({
 Dialog:({children}:{children:React.ReactNode})=><>{children}</>,DialogContent:({children}:{children:React.ReactNode})=><div role="dialog">{children}</div>,
 DialogHeader:({children}:{children:React.ReactNode})=><div>{children}</div>,DialogFooter:({children}:{children:React.ReactNode})=><div>{children}</div>,
 DialogTitle:({children}:{children:React.ReactNode})=><h2>{children}</h2>,DialogDescription:({children}:{children:React.ReactNode})=><p>{children}</p>,
}));
const order={id:"cream-order",code:"SX000047",status:"completed",productId:"cream",productName:"Kem Sữa",branchName:"Quán",completedQty:585,plannedQty:580,updatedAt:"2026-10-14T09:50:32Z",
 materials:[{productId:"rich",productName:"Rich",unit:"Hộp",plannedQty:3.441,actualQty:3.441}]} as ProductionOrder;
beforeEach(()=>{vi.clearAllMocks();mocks.detail.mockResolvedValue(order);mocks.correct.mockResolvedValue({});});
afterEach(cleanup);
describe("production correction workflow",()=>{
 it("requires a reason and sends measured units, original version and a request ID",async()=>{
   render(<CorrectProductionOrderDialog order={order} onClose={vi.fn()} onSuccess={vi.fn()} />);
   const quantity=await screen.findByLabelText("Thực dùng Rich");
   const save=screen.getByRole("button",{name:"Lưu điều chỉnh"});
   expect(save).toBeDisabled();
   fireEvent.change(screen.getByLabelText("Đơn vị Thực dùng Rich"),{target:{value:"G"}});
   fireEvent.change(quantity,{target:{value:"400"}});
   fireEvent.change(screen.getByPlaceholderText("Ví dụ: nhập nhầm lượng Rich ONTOP"),{target:{value:"Nhập nhầm"}});
   fireEvent.click(save);
   await waitFor(()=>expect(mocks.correct).toHaveBeenCalledOnce());
   expect(mocks.correct.mock.calls[0][0]).toMatchObject({orderId:order.id,expectedUpdatedAt:order.updatedAt,outputQuantity:585,reason:"Nhập nhầm",cancel:false,
     materials:[{productId:"rich",quantity:400,unit:"G",expectedFactor:expect.any(Number)}]});
   expect(mocks.correct.mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/);
 });
 it("keeps an actionable error and entered values when output has already been used",async()=>{
   const close=vi.fn();mocks.correct.mockRejectedValue(new Error("Thành phẩm đã được dùng"));
   render(<CorrectProductionOrderDialog order={order} onClose={close} onSuccess={vi.fn()} />);
   const quantity=await screen.findByLabelText("Thực dùng Rich");
   fireEvent.change(quantity,{target:{value:"0.441"}});
   fireEvent.change(screen.getByPlaceholderText("Ví dụ: nhập nhầm lượng Rich ONTOP"),{target:{value:"Nhập nhầm"}});
   fireEvent.click(screen.getByRole("button",{name:"Lưu điều chỉnh"}));
   expect(await screen.findByRole("alert")).toHaveTextContent("Thành phẩm đã được dùng");
   expect(quantity).toHaveValue(.441);expect(close).not.toHaveBeenCalled();
 });
 it("cancels with a reason and no replacement recipe, preserving the existing document identity",async()=>{
   render(<CorrectProductionOrderDialog order={order} cancel onClose={vi.fn()} onSuccess={vi.fn()} />);
   await screen.findByText("Nguyên liệu hoàn lại");
   fireEvent.change(screen.getByPlaceholderText("Ví dụ: nhập nhầm lượng Rich ONTOP"),{target:{value:"Tạo nhầm"}});
   fireEvent.click(screen.getByRole("button",{name:"Hủy & hoàn kho"}));
   await waitFor(()=>expect(mocks.correct).toHaveBeenCalledOnce());
   expect(mocks.correct.mock.calls[0][0]).toMatchObject({orderId:order.id,cancel:true,outputQuantity:0,materials:[],reason:"Tạo nhầm"});
 });
});
