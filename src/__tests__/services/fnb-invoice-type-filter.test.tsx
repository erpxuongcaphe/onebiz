import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FnbInvoiceTypeFilter } from "@/components/shared/fnb-invoice-type-filter";
import { invoiceFnbTypeLabel, type FnbInvoiceType } from "@/lib/utils/invoice-list-filters";
const state = vi.hoisted(() => ({calls: [] as Array<[string, ...unknown[]]>, rows: [] as unknown[], rpc: [] as unknown[]}));
vi.mock("@/lib/services/supabase/base", () => ({
 getCurrentTenantId: async () => "tenant-a", getPaginationRange: () => ({from:15,to:29}), handleError:(error:unknown)=>{throw error;},
 getClient: () => ({from:(table:string)=>{
   const q: Record<string,unknown> = {};
   for(const name of ["select","eq","is","in","or","order","range","ilike","gte","lt"]){
     q[name]=(...args:unknown[])=>{state.calls.push([table+"."+name,...args]);return q;};
   }
   q.then=(resolve:(v:unknown)=>void)=>resolve({data:table==="invoices"?state.rows:[],count:27,error:null});return q;
 },rpc:async(name:string,args:unknown)=>{state.rpc.push({name,args});return {data:[{}],error:null};}})
}));
import { getInvoices, getInvoiceListSummary, khoaChiSoHoaDon } from "@/lib/services/supabase/invoices";
beforeEach(()=>{cleanup();state.calls=[];state.rows=[];state.rpc=[];});
describe("F&B invoice administration",()=>{
 it("touch buttons expose current selection and switch by name",()=>{
   const change=vi.fn();const {rerender}=render(<FnbInvoiceTypeFilter value="all" onChange={change}/>);
   expect(screen.getByRole("button",{name:"Tất cả"}).getAttribute("aria-pressed")).toBe("true");
   fireEvent.click(screen.getByRole("button",{name:"Mang về"}));expect(change).toHaveBeenCalledWith("takeaway");
   rerender(<FnbInvoiceTypeFilter value="takeaway" onChange={change}/>);
   expect(screen.getByRole("button",{name:"Mang về"}).getAttribute("aria-pressed")).toBe("true");
 });
 it.each(["dine_in","takeaway","delivery"])("filters %s on server before pagination without requiring shipment",async(type)=>{
   await getInvoices({page:1,pageSize:15,branchId:"branch-a",filters:{fnbOrderType:type}});
   const select=state.calls.find(call=>call[0]==="invoices.select");
   expect(select?.[1]).toContain("fnb_orders:kitchen_orders!kitchen_orders_invoice_id_fkey!inner(order_type)");
   expect(select?.[1]).not.toContain("shipping_orders_invoice_id_fkey!inner");
   expect(state.calls).toContainEqual(["invoices.eq","source","fnb"]);
   expect(state.calls).toContainEqual(["invoices.eq","fnb_orders.order_type",type]);
   expect(state.calls).toContainEqual(["invoices.eq","fnb_orders.tenant_id","tenant-a"]);
   expect(state.calls).toContainEqual(["invoices.eq","branch_id","branch-a"]);
   expect(state.calls.findIndex(call=>call[1]==="fnb_orders.order_type")).toBeLessThan(state.calls.findIndex(call=>call[0]==="invoices.range"));
   await getInvoiceListSummary({branchId:"branch-a",fnbOrderType:type as FnbInvoiceType});
   expect(state.rpc).toEqual([{name:"get_invoice_list_summary",args:expect.objectContaining({p_delivery:"fnb_"+type,p_branch_id:"branch-a"})}]);
 });
 it("keeps existing Retail shipment filter and does not default unknown historical type",async()=>{
   state.rows=[{id:"old",source:"fnb",status:"completed",shipments:[],fnb_orders:[]}];
   const r=await getInvoices({page:0,pageSize:15,filters:{delivery:"delivery"}});
   expect(state.calls.find(call=>call[0]==="invoices.select")?.[1]).toContain("shipping_orders_invoice_id_fkey!inner");
   expect(r.data[0].fnbOrderType).toBeUndefined();expect(invoiceFnbTypeLabel()).toBe("Chưa ghi nhận");
 });
 it("separates cached summary totals for the three POS types",()=>{
   expect(new Set(["dine_in","takeaway","delivery"].map(type=>khoaChiSoHoaDon({fnbOrderType:type as "dine_in"})))).toHaveProperty("size",3);
 });
});
