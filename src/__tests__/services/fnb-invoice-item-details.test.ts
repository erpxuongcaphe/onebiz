import {describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({rpc:vi.fn(),rows:Array.from({length:401},(_,i)=>({invoice_id:"invoice",invoice_item_id:`line-${i}`,note:null,variant_label:"Size L",modifier_selections:[],detail_source:"snapshot"}))}));
vi.mock("@/lib/services/supabase/base",()=>({getClient:()=>({rpc:(...args:unknown[])=>{
 mock.rpc(...args);let from=0,to=199;const q:Record<string,unknown>={order:()=>q,range:(a:number,b:number)=>{from=a;to=b;return q;},then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:mock.rows.slice(from,to+1),count:mock.rows.length,error:null}).then(resolve)};return q;
}})}));
import {getFnbInvoiceItemDetails} from "@/lib/services/supabase/fnb-invoice-item-details";
describe("bounded paged invoice option reader",()=>{
 it("reads every metadata row beyond default page size without matching by product",async()=>{const r=await getFnbInvoiceItemDetails(["invoice"]);expect(r.size).toBe(401);expect(mock.rpc).toHaveBeenCalledTimes(3);expect(r.get("line-400")?.variant_label).toBe("Size L");});
 it("rejects an oversized request without querying",async()=>{mock.rpc.mockClear();await expect(getFnbInvoiceItemDetails(Array(101).fill("x"))).rejects.toThrow("100");expect(mock.rpc).not.toHaveBeenCalled();});
});
