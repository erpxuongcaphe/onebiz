import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({previewShiftClose:vi.fn(),reconcilePendingShift:vi.fn(),getPendingShifts:vi.fn(),toast:vi.fn()}));
vi.mock("@/lib/services/supabase/shifts",()=>api);
vi.mock("@/lib/contexts",()=>({useAuth:()=>({user:{id:"manager"},branches:[{id:"b",branchType:"store"}]}),useToast:()=>({toast:api.toast})}));
import {ReconcileShiftDialog} from "@/components/shared/shift/pending-shift-alert";
beforeEach(()=>{vi.clearAllMocks();api.previewShiftClose.mockResolvedValue({startingCash:0,cashIn:0,cashOut:0,expectedCash:0,totalSales:500,totalOrders:1,salesByMethod:{transfer:500},cashEntries:[]});api.reconcilePendingShift.mockResolvedValue({});});afterEach(cleanup);
it("requires a bank-total count when a manager closes a pending F&B shift",async()=>{
 const done=vi.fn();render(<ReconcileShiftDialog shift={{id:"s",branchId:"b",cashierId:"cashier",cashierName:"Thu ngân",branchName:"Tư Búa",openedAt:"2026-10-22T00:00:00Z"} as any} onClose={()=>{}} onDone={done}/>);
 await screen.findByLabelText("Tổng chuyển khoản thực nhận *");
 fireEvent.change(screen.getByLabelText("Tiền mặt thực tế đếm được *"),{target:{value:"0"}});
 fireEvent.change(screen.getByPlaceholderText("VD: Trang về sớm quên đóng / Mất điện / ..."),{target:{value:"Quên đóng ca"}});
 const close=screen.getByRole("button",{name:"Đối chiếu & chốt ca"});expect(close).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Đã nhận đủ 500đ"}));expect(close).toBeEnabled();fireEvent.click(close);fireEvent.click(screen.getByRole("button",{name:"Xác nhận"}));
 await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));expect(api.reconcilePendingShift).toHaveBeenCalledWith(expect.objectContaining({actualCash:0,reason:"Quên đóng ca",reconciliation:{actualTransfer:500,expectedCash:0,expectedTransfer:500,closeKind:"end_of_day"}}));
});
