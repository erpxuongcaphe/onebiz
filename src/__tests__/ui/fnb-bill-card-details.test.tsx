import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FnbOpenOrdersDialog } from "@/app/pos/fnb/components/fnb-open-orders-dialog";
import { buildFnbTableBillDetails, getFnbBillCardIdentity, matchesFnbBillCardSearch } from "@/lib/fnb-bill-card-details";
import { FnbBillIdentity } from "@/components/shared/fnb-bill-identity";
import type { FnbOpenOrder } from "@/lib/fnb-open-orders";
afterEach(cleanup);
const orders=[{id:"a",orderNumber:"KB001",tableId:"table",tableName:"Bàn 1",orderType:"dine_in",status:"pending",customerName:"Chị Hằng",note:"Giao cổng sau",invoiceId:null,mergedIntoId:null,itemCount:1,provisionalTotal:25000},{id:"b",orderNumber:"KB002",tableId:null,orderType:"delivery",status:"ready",customerName:"Anh Bình",note:"Gọi trước khi giao",invoiceId:null,mergedIntoId:null,itemCount:2,provisionalTotal:50000},{id:"c",orderNumber:"KB003",tableId:null,orderType:"takeaway",status:"pending",customerName:"Chị Mai",note:"Lấy lúc 10h",invoiceId:null,mergedIntoId:null,itemCount:1,provisionalTotal:22000}] as FnbOpenOrder[];
describe("customer and order notes on bill cards",()=>{
 it("renders the actual names and order notes on all order types, searches accents and opens only on click",()=>{
  const opened=vi.fn();render(<FnbOpenOrdersDialog open onOpenChange={vi.fn()} orders={orders} drafts={[]} onOpenOrder={opened} onOpenDraft={vi.fn()} updatedAt={null} loading={false} error={null} connected busy={false} onRefresh={vi.fn()}/>);
  for(const name of ["Chị Hằng","Anh Bình","Chị Mai"])expect(screen.getByLabelText(`Khách: ${name}`)).toBeInTheDocument();
  expect(screen.getByText("Ghi chú: Lấy lúc 10h")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox",{name:"Tìm đơn đang mở"}),{target:{value:"goi truoc"}});
  expect(screen.getByLabelText("Khách: Anh Bình")).toBeInTheDocument();expect(screen.queryByLabelText("Khách: Chị Mai")).not.toBeInTheDocument();expect(opened).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:/KB002/}));expect(opened).toHaveBeenCalledWith(orders[1]);
 });
 it("keeps each bill's identity and excludes paid or merged bills from table summaries",()=>{
  const details=buildFnbTableBillDetails([...orders,{...orders[0],id:"d",orderNumber:"KB004",customerName:"Khách khác"},{...orders[0],id:"paid",invoiceId:"invoice"},{...orders[0],id:"merged",mergedIntoId:"a"}]);
  expect(details.table).toHaveLength(2);expect(details.table.map(d=>d.customerName)).toEqual(["Chị Hằng","Khách khác"]);expect(Object.keys(details)).toEqual(["table"]);
 });
 it("uses a guest fallback, handles empty notes and renders notes as text",()=>{
  const v=render(<FnbBillIdentity customerName=" " note=" "/>);expect(screen.getByText("Khách: Khách lẻ")).toBeInTheDocument();expect(screen.queryByText(/Ghi chú:/)).not.toBeInTheDocument();
  v.rerender(<FnbBillIdentity customerName="A" note="<script>no()</script>"/>);expect(screen.getByText("Ghi chú: <script>no()</script>")).toBeInTheDocument();expect(v.container.querySelector("script")).toBeNull();
  expect(matchesFnbBillCardSearch("chi hang", "Chị Hằng")).toBe(true);
 });
 it("promotes guest notes on every order type while keeping named customers",()=>{
  const guestOrders=orders.map(order=>({...order,customerName:"Khách lẻ"}));
  render(<FnbOpenOrdersDialog open onOpenChange={vi.fn()} orders={guestOrders} drafts={[]} onOpenOrder={vi.fn()} onOpenDraft={vi.fn()} updatedAt={null} loading={false} error={null} connected busy={false} onRefresh={vi.fn()}/>);
  for(const order of guestOrders)expect(screen.getByLabelText(`Ghi chú: ${order.note}`)).toHaveAttribute("title",order.note);
  expect(screen.queryByLabelText("Khách: Khách lẻ")).not.toBeInTheDocument();
  expect(getFnbBillCardIdentity("Chị Hằng","Giao cổng sau")).toEqual({text:"Chị Hằng",isNote:false});
 });
 it.each([null,"","Khách lẻ"," KHÁCH LẺ "])("uses the note only for guest identity %s",name=>{
  expect(getFnbBillCardIdentity(name,"  Áo xanh, bàn ngoài  ")).toEqual({text:"Áo xanh, bàn ngoài",isNote:true});
  expect(getFnbBillCardIdentity(name," ").isNote).toBe(false);
 });

});
