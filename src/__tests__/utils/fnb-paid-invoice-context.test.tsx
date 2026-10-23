import {describe,it,expect} from "vitest";
import {render,screen} from "@testing-library/react";
import {readFnbInvoiceContext} from "@/lib/utils/fnb-invoice-context";
import {FnbInvoiceContext} from "@/components/shared/fnb-invoice-context";
const order={created_at:"2026-10-23T03:00:00Z",note:"Khách lấy thêm ly",restaurant_tables:{name:"TN 03",table_number:3,zone:"Old zone",floor_plan_zones:{name:"Trong nhà"}}};
describe("paid F&B service context",()=>{
 it("uses exact original order opening and invoice insertion time, never document or updated times",()=>{
  const context=readFnbInvoiceContext({source:"fnb",created_at:"2026-10-23T04:25:00Z",issued_at:"2026-01-01",updated_at:"2026-12-01"},order);
  expect(context).toEqual({tableName:"TN 03",tableNumber:"3",areaName:"Trong nhà",openedAt:order.created_at,paidAt:"2026-10-23T04:25:00Z",posNote:order.note});
 });
 it("snapshot takes precedence over renamed table, zone and edited note, including deliberately empty fields",()=>{
  const frozen={version:1,table_name:"NS 02",table_number:2,area_name:"Ngoài sân",opened_at:"2026-10-22T16:00:00Z",paid_at:"2026-10-23T01:00:00Z",pos_note:null};
  const value=readFnbInvoiceContext({source:"fnb",fnb_context:frozen},order);
  expect(value.tableName).toBe("NS 02");expect(value.areaName).toBe("Ngoài sân");expect(value.posNote).toBeUndefined();expect(value.openedAt).toBe(frozen.opened_at);
 });
 it("does not invent missing historical opening time or attach F&B context to Retail",()=>{
  expect(readFnbInvoiceContext({source:"retail"},order)).toEqual({});
  expect(readFnbInvoiceContext({source:"fnb"}).openedAt).toBeUndefined();
  expect(readFnbInvoiceContext({source:"fnb",created_at:"invalid"}).paidAt).toBeUndefined();
 });
 it("renders clear readable note and separate Vietnam opening/payment times with area in compact and detail layouts",()=>{
  const value=readFnbInvoiceContext({source:"fnb",created_at:"2026-10-23T04:25:00Z"},order);
  render(<FnbInvoiceContext value={value} compact/>);
  expect(screen.getByText("· Trong nhà")).toBeInTheDocument();expect(screen.getByText("Ghi chú: Khách lấy thêm ly")).toHaveClass("font-medium");
  expect(screen.getByText("23/10/2026 10:00")).toBeInTheDocument();expect(screen.getByText("23/10/2026 11:25")).toBeInTheDocument();
 });
});
