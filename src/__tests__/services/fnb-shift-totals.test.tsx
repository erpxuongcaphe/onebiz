import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {shiftTotalsDraft,countedAmount} from "@/lib/shift-reconciliation";
const api=vi.hoisted(()=>({previewShiftClose:vi.fn()}));
vi.mock("@/lib/services/supabase/shifts",()=>api);
import {CloseShiftDialog} from "@/app/pos/fnb/components/shift-dialog";
const preview={startingCash:100,cashIn:200,cashOut:0,expectedCash:300,totalSales:700,totalOrders:2,salesByMethod:{cash:200,transfer:500},cashEntries:[]};
const shift={id:"s1",openedAt:"2026-10-22T00:00:00Z",cashierId:"cashier"} as any;
beforeEach(()=>{vi.clearAllMocks();api.previewShiftClose.mockResolvedValue(preview);});afterEach(cleanup);
describe("F&B shift totals",()=>{
 it("does not interpret blank counted cash/bank as zero, and rejects non-finite or negative cash",()=>{
  expect(countedAmount("")).toBeNull();expect(countedAmount("NaN")).toBeNull();expect(countedAmount("-1")).toBeNull();
  expect(countedAmount("0")).toBe(0);expect(countedAmount("-50",true)).toBe(-50);
  expect(shiftTotalsDraft(preview,"300","","end_of_day","").valid).toBe(false);
 });
 it("requires a saved explanation for a difference and keeps the cash/bank amounts separate",()=>{
  expect(shiftTotalsDraft(preview,"299","500","end_of_day","").valid).toBe(false);
  expect(shiftTotalsDraft(preview,"299","500","end_of_day","Đếm thiếu").input).toEqual({actualTransfer:500,expectedCash:300,expectedTransfer:500,closeKind:"end_of_day"});
 });
 it("closes the last shift with counted cash and one bank-total confirmation, without a recipient",async()=>{
  const confirm=vi.fn().mockResolvedValue(undefined);
  render(<CloseShiftDialog open currentShift={shift} onOpenChange={()=>{}} onConfirm={confirm} reconcileTransfer/>);
  await screen.findByText("Ca cuối ngày không cần người nhận bàn giao. Đếm tiền mặt trước khi cất hoặc nộp; ca sau mở bằng số thực để lại quầy.");
  const close=screen.getByRole("button",{name:"Đóng ca"});expect(close).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Tiền mặt thực đếm trong ngăn kéo *"),{target:{value:"300"}});
  expect(close).toBeDisabled();fireEvent.click(screen.getByRole("button",{name:"Đã nhận đủ 500đ"}));
  expect(close).toBeEnabled();fireEvent.click(close);fireEvent.click(screen.getByRole("button",{name:"Xác nhận đóng ca"}));
  await waitFor(()=>expect(confirm).toHaveBeenCalledWith(300,undefined,{actualTransfer:500,expectedCash:300,expectedTransfer:500,closeKind:"end_of_day"}));
  expect(screen.queryByLabelText(/Người nhận/)).toBeNull();
 });
 it("keeps counted inputs after a rejected close and lets staff refresh totals in place",async()=>{
  const confirm=vi.fn().mockRejectedValue(new Error("Số tiền của ca vừa thay đổi"));
  render(<CloseShiftDialog open currentShift={shift} onOpenChange={()=>{}} onConfirm={confirm} reconcileTransfer/>);
  await screen.findByLabelText("Tổng chuyển khoản thực nhận *");
  fireEvent.change(screen.getByLabelText("Tiền mặt thực đếm trong ngăn kéo *"),{target:{value:"300"}});
  fireEvent.click(screen.getByRole("button",{name:"Đã nhận đủ 500đ"}));fireEvent.click(screen.getByRole("button",{name:"Đóng ca"}));
  fireEvent.click(screen.getByRole("button",{name:"Xác nhận đóng ca"}));await screen.findByRole("alert");
  expect(screen.getByLabelText("Tiền mặt thực đếm trong ngăn kéo *")).toHaveValue(300);
  expect(screen.getByLabelText("Tổng chuyển khoản thực nhận *")).toHaveValue(500);
  api.previewShiftClose.mockResolvedValue({...preview,expectedCash:310});fireEvent.click(screen.getByRole("button",{name:"Tải lại tổng quan"}));
  await waitFor(()=>expect(api.previewShiftClose).toHaveBeenCalledTimes(2));
  await screen.findByText("Nhập lý do chênh lệch trong ghi chú (ít nhất 3 ký tự).");
  expect(screen.getByRole("button",{name:"Đóng ca"})).toBeDisabled();
 });
 it("does not require bank totals on the existing Retail dialog",async()=>{
  const confirm=vi.fn().mockResolvedValue(undefined);
  render(<CloseShiftDialog open currentShift={shift} onOpenChange={()=>{}} onConfirm={confirm}/>);
  await screen.findByLabelText("Tiền mặt thực đếm trong ngăn kéo *");
  expect(screen.queryByLabelText("Tổng chuyển khoản thực nhận *")).toBeNull();
  fireEvent.change(screen.getByLabelText("Tiền mặt thực đếm trong ngăn kéo *"),{target:{value:"0"}});
  expect(screen.getByRole("button",{name:"Đóng ca"})).toBeEnabled();
 });
});
