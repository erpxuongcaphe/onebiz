import {beforeEach,expect,it,vi} from "vitest";
import {cleanup,render,screen,fireEvent} from "@testing-library/react";
import {RetailInvoiceTypeFilter} from "@/components/shared/retail-invoice-type-filter";
import type {RetailInvoiceType} from "@/lib/utils/invoice-list-filters";
const state=vi.hoisted(()=>({calls:[] as Array<[string,...unknown[]]>,rpc:[] as unknown[],rows:[] as unknown[]}));
vi.mock("@/lib/services/supabase/base",()=>({getCurrentTenantId:async()=>"tenant-a",getPaginationRange:()=>({from:15,to:29}),handleError:(e:unknown)=>{throw e;},getClient:()=>({from:(table:string)=>{
 const q:Record<string,unknown>={};for(const name of ["select","eq","is","in","or","order","range","ilike","gte","lt"])q[name]=(...args:unknown[])=>{state.calls.push([table+"."+name,...args]);return q;};
 q.then=(resolve:(v:unknown)=>void)=>resolve({data:table==="invoices"?state.rows:[],count:20,error:null});return q;
},rpc:async(name:string,args:unknown)=>{state.rpc.push({name,args});return{data:[{}],error:null};}})}));
import {getInvoices,getInvoiceListSummary,khoaChiSoHoaDon} from "@/lib/services/supabase/invoices";
beforeEach(()=>{cleanup();state.calls=[];state.rpc=[];state.rows=[];});
it("compact filter switches Retail group and exposes current selection",()=>{
 const change=vi.fn();render(<RetailInvoiceTypeFilter value="internal" onChange={change}/>);
 expect(screen.getByRole("button",{name:"Nội bộ"}).getAttribute("aria-pressed")).toBe("true");
 fireEvent.click(screen.getByRole("button",{name:"Giao hàng"}));expect(change).toHaveBeenCalledWith("delivery");
});
it.each(["no_delivery","delivery","internal"] as RetailInvoiceType[])("filters %s before pagination and sends matching summary mode",async(type)=>{
 await getInvoices({page:1,pageSize:15,branchId:"branch-a",filters:{retailSaleType:type}});
 const selection=state.calls.find(c=>c[0]==="invoices.select")?.[1] as string;
 expect(selection).not.toContain("fnb_orders:");
 expect(state.calls).toContainEqual(["invoices.eq","tenant_id","tenant-a"]);
 expect(state.calls).toContainEqual(["invoices.eq","branch_id","branch-a"]);
 if(type==="internal"){
   expect(state.calls).toContainEqual(["invoices.eq","source","internal"]);
   expect(selection).not.toContain("shipping_orders_invoice_id_fkey!inner");
 }else{
   expect(state.calls).toContainEqual(["invoices.or","source.is.null,and(source.neq.internal,source.neq.fnb)"]);
   if(type==="delivery")expect(selection).toContain("shipping_orders_invoice_id_fkey!inner");
   else expect(state.calls).toContainEqual(["invoices.is","shipments",null]);
 }
 const condition=state.calls.findIndex(c=>c[0]==="invoices.eq"&&c[1]==="source"||c[0]==="invoices.or"&&c[1]==="source.is.null,and(source.neq.internal,source.neq.fnb)");
 expect(condition).toBeLessThan(state.calls.findIndex(c=>c[0]==="invoices.range"));
 await getInvoiceListSummary({retailSaleType:type,branchId:"branch-a"});
 expect(state.rpc).toContainEqual({name:"get_invoice_list_summary",args:expect.objectContaining({p_delivery:"retail_"+type,p_branch_id:"branch-a"})});
});
it("internal classification wins even if a shipment exists; NULL legacy source is not guessed internal",async()=>{
 state.rows=[{id:"internal",source:"internal",shipments:[{id:"ship"}],status:"completed"},{id:"legacy",source:null,shipments:[],status:"completed"},{id:"fnb",source:"fnb",shipments:[],status:"completed"}];
 const r=await getInvoices({page:0,pageSize:15});
 expect(r.data.map(i=>i.retailSaleType)).toEqual(["internal","no_delivery",undefined]);
});
it("summary cache separates all Retail categories",()=>{
 expect(new Set((["all","no_delivery","delivery","internal"] as RetailInvoiceType[]).map(type=>khoaChiSoHoaDon({retailSaleType:type}))).size).toBe(4);
});
