import {beforeEach,describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),source:"fnb",items:[] as Record<string,unknown>[],parent:true,calls:[] as unknown[]}));
vi.mock("@/lib/services/supabase/base",()=>({
 getCurrentTenantId:async()=>"tenant",getPaginationRange:()=>({from:0,to:10}),
 handleError:(e:{message:string})=>{throw new Error(e.message);},
 getClient:()=>({rpc:(name:string,...args:unknown[])=>{const result=mock.rpc(name,...args);const q:Record<string,unknown>={order:()=>q,range:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result).then(resolve)};return q;},from:mock.from})
}));
import {getInvoiceItems} from "@/lib/services/supabase/invoices";
import {getFnbInvoiceItemNotes} from "@/lib/services/supabase/fnb-invoice-item-notes";
beforeEach(()=>{
 vi.clearAllMocks();mock.source="fnb";mock.parent=true;mock.calls=[];
 mock.items=[{id:"a",product_name:"Cà phê",note:null,quantity:1,total:22000},{id:"b",product_name:"Cà phê",note:"Snapshot",quantity:1,total:22000},{id:"c",product_name:"Cà phê",note:"",quantity:1,total:22000}];
 mock.rpc.mockResolvedValue({data:[{invoice_id:"inv",invoice_item_id:"a",note:"Ít đá"},{invoice_item_id:"b",note:"Wrong override"},{invoice_item_id:"c",note:"Wrong override"}],error:null});
 mock.from.mockImplementation((table:string)=>{
  const result={data:table==="invoices"?(mock.parent?{id:"inv",source:mock.source}:null):mock.items,error:null};
  const q:Record<string,unknown>={};for(const op of ["select","eq","maybeSingle"])q[op]=(...args:unknown[])=>{mock.calls.push({table,op,args});return q;};q.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve(result).then(resolve);return q;
 });
});
describe("invoice note read boundaries",()=>{
 it("uses exact item IDs and preserves saved/explicit empty notes for duplicate products",async()=>{
  const items=await getInvoiceItems("inv");expect(items.map(i=>i.note)).toEqual(["Ít đá","Snapshot",""]);
  expect(mock.rpc).toHaveBeenCalledWith("get_fnb_invoice_item_details_20261023",{p_invoice_ids:["inv"]},{count:"exact"});
  expect(items.map(i=>i.total)).toEqual([22000,22000,22000]);
 });
 it("does not call FNB resolver for Retail or missing parent invoice",async()=>{
  mock.source="pos";await getInvoiceItems("inv");expect(mock.rpc).not.toHaveBeenCalled();
  mock.parent=false;expect(await getInvoiceItems("foreign")).toEqual([]);expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("does not pretend a denied/failed note read is an empty note",async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{message:"BRANCH_ACCESS_DENIED"}});
  await expect(getFnbInvoiceItemNotes("inv")).rejects.toThrow("BRANCH_ACCESS_DENIED");
 });
 it("keeps actual item rows visible when optional metadata read fails",async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{message:"INVOICE_VIEW_REQUIRED"}});
  const result=await getInvoiceItems("inv");expect(result).toHaveLength(3);expect(result[0].productName).toBe("Cà phê");expect(result.every(r=>r.fnbDetailsUnavailable)).toBe(true);
 });

});
