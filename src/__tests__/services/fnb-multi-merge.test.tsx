import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FnbMergeBillsDialog } from "@/app/pos/fnb/components/fnb-merge-bills-dialog";
import { canMergeFnbOrder, getFnbMergePlan } from "@/lib/fnb-merge-plan";
import type { FnbOpenOrder } from "@/lib/fnb-open-orders";
afterEach(cleanup);
const make=(id:string, patch:Partial<FnbOpenOrder>={}):FnbOpenOrder=>({ id, branchId:"branch",tenantId:"tenant",invoiceId:null,mergedIntoId:null,orderNumber:`KB${id}`,orderType:"dine_in",status:"pending",tableId:"table-1",tableName:"Bàn 1",customerName:"Khách lẻ",customerId:null,itemCount:2,provisionalTotal:44000,discountAmount:1000,deliveryFee:0,platformCommission:0,platformCommissionPercent:0,...patch } as FnbOpenOrder);
const orders=[make("1"),make("2",{tableId:"table-2",tableName:"Bàn 2",provisionalTotal:25000,customerId:"customer",customerName:"Khách A"}),make("3",{orderType:"takeaway",tableId:null,tableName:undefined,provisionalTotal:30000}),make("4",{orderType:"delivery",tableId:null,deliveryFee:5000}),make("5",{invoiceId:"invoice"})];
const props=()=>({orders,branchId:"branch",pendingIds:[] as string[],busy:false,loading:false,error:null as string|null,online:true,onClose:vi.fn(),onRefresh:vi.fn(),onConfirm:vi.fn()});
const select=(id:string)=>fireEvent.click(screen.getByLabelText(`Chọn KB${id} để gộp`));
describe("multiple bill merge selection",()=>{
 it("selects several bills across tables and takeaway, previews amounts and submits once",()=>{
  const p=props();render(<FnbMergeBillsDialog {...p}/>);select("1");select("2");select("3");
  expect(p.onConfirm).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"Xác nhận gộp 3 bill"})).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Bill giữ lại sau gộp"),{target:{value:"3"}});
  expect(screen.getByLabelText("Xem trước gộp bill")).toHaveTextContent(/99[.,]000/);
  expect(screen.getByText(/Các bill khác khách/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Xác nhận gộp 3 bill"}));expect(p.onConfirm).toHaveBeenCalledExactlyOnceWith("3",["1","2","3"]);
  expect(screen.queryByLabelText("Chọn KB4 để gộp")).not.toBeInTheDocument();expect(screen.queryByLabelText("Chọn KB5 để gộp")).not.toBeInTheDocument();
 });
 it("keeps selections across search and clears the destination if its checkbox is removed",()=>{
  render(<FnbMergeBillsDialog {...props()} initialId="1"/>);select("2");
  fireEvent.change(screen.getByLabelText("Tìm bill để gộp"),{target:{value:"khach a"}});
  expect(screen.getByLabelText("Chọn KB2 để gộp")).toBeChecked();expect(screen.queryByLabelText("Chọn KB1 để gộp")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Tìm bill để gộp"),{target:{value:""}});select("1");expect(screen.getByLabelText("Bill giữ lại sau gộp")).toHaveValue("");
 });
 it("blocks stale paid selections and lets staff reset them without losing a real cart",()=>{
  const p=props();const view=render(<FnbMergeBillsDialog {...p} initialId="1"/>);select("2");
  view.rerender(<FnbMergeBillsDialog {...p} initialId="1" orders={orders.map(o=>o.id==="2"?{...o,invoiceId:"new-payment"}:o)}/>);
  expect(screen.getByRole("status")).toHaveTextContent("Có bill đã thay đổi");expect(screen.getByRole("button",{name:"Xác nhận gộp 2 bill"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Bỏ chọn tất cả"}));expect(screen.getByRole("status")).toHaveTextContent("ít nhất 2 bill");
 });
 it.each([{online:false},{error:"Không tải được"},{loading:true},{busy:true},{pendingIds:["2"]}])("blocks confirmation on unavailable or unsent state %j",patch=>{
  const p={...props(),...patch};const view=render(<FnbMergeBillsDialog {...p} busy={false} initialId="1"/>);select("2");view.rerender(<FnbMergeBillsDialog {...p} initialId="1"/>);
  expect(screen.getByRole("button",{name:p.busy?"Đang gộp…":"Xác nhận gộp 2 bill"})).toBeDisabled();expect(p.onConfirm).not.toHaveBeenCalled();
 });
 it("blocks close and changing selection while submitting",()=>{
  const p=props();render(<FnbMergeBillsDialog {...p} busy initialId="1"/>);
  expect(screen.getByLabelText("Chọn KB1 để gộp")).toBeDisabled();fireEvent.click(screen.getByRole("button",{name:"Đóng"}));expect(p.onClose).not.toHaveBeenCalled();
 });
 it("does not seed an excluded delivery bill from the current cart",()=>{render(<FnbMergeBillsDialog {...props()} initialId="4"/>);expect(screen.getByRole("status")).toHaveTextContent("ít nhất 2 bill");});
 it("validates branch, target, duplicate ids and pending lines for every selected bill",()=>{
  expect(canMergeFnbOrder(make("1",{branchId:"other"}),"branch")).toBe(false);
  expect(getFnbMergePlan(orders,["1","2"],"3","branch").error).toMatch(/bill giữ lại/);
  expect(getFnbMergePlan(orders,["1","1"],"1","branch").error).toMatch(/trùng/);
  expect(getFnbMergePlan(orders,["1","2"],"1","branch",["1"]).error).toMatch(/chưa gửi/);
  expect(getFnbMergePlan(orders,["1","2","3"],"1","branch").total).toBe(99000);
 });
});
