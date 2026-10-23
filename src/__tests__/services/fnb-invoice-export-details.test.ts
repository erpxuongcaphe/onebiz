import {beforeEach,describe,it,expect,vi} from "vitest";
import type {Invoice} from "@/lib/types";
const mock=vi.hoisted(()=>({lines:[] as Record<string,unknown>[],details:vi.fn(),calls:[] as {table:string;op:string;args:unknown[]}[],fail:false}));
vi.mock("@/lib/services/supabase/fnb-invoice-item-details",()=>({getFnbInvoiceItemDetails:mock.details}));
vi.mock("@/lib/services/supabase/base",()=>({getClient:()=>({from:(table:string)=>{
 let rows=mock.lines,from=0,to=199;const q:Record<string,unknown>={};
 for(const op of ["select","in","order","range"])q[op]=(...args:unknown[])=>{mock.calls.push({table,op,args});if(op==="in")rows=rows.filter(r=>(args[1] as string[]).includes(String(r[String(args[0])])));if(op==="range"){from=Number(args[0]);to=Number(args[1]);}return q;};
 q.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:rows.slice(from,Math.min(to+1,from+50)),count:rows.length,error:mock.fail?{message:"denied"}:null}).then(resolve);return q;
}})}));
import {getFnbInvoiceExportDetails} from "@/lib/services/supabase/fnb-invoice-export-details";
const parents=[{id:"a",code:"HD-A",source:"fnb",totalAmount:50000,posNote:"Giao riêng",tableName:"TN 03"},{id:"b",code:"HD-B",source:"fnb",totalAmount:25000}] as Invoice[];
beforeEach(()=>{vi.clearAllMocks();mock.calls=[];mock.fail=false;mock.lines=Array.from({length:1001},(_,i)=>({id:`line-${i}`,invoice_id:i%2?"a":"b",product_name:"Bạc Sỉu (Size L)",quantity:1,returned_qty:0,unit:"Ly",unit_price:25000,total:25000,note:null,products:{code:"SKU-CAP"}}));
 mock.details.mockImplementation(async()=>new Map(mock.lines.map((r,i)=>[r.id,{invoice_id:r.invoice_id,invoice_item_id:r.id,variant_label:"Size L",note:"Để riêng",modifier_selections:[{groupName:"Đá/Nóng",options:[{label:i%2?"Nóng":"Đá"}]}]}])));
});
describe("complete FNB option export",()=>{
 it("reads all 1001 item lines despite a 50-row server cap, retaining exact size and hot/cold per duplicate product",async()=>{
  const result=await getFnbInvoiceExportDetails(parents);expect(result.items).toHaveLength(1001);expect(mock.calls.filter(c=>c.op==="range")).toHaveLength(21);
  expect(result.items[0]).toMatchObject({productName:"Bạc Sỉu",size:"Size L",temperature:"Đá",quantity:1});expect(result.items[1].temperature).toBe("Nóng");expect(result.summaries.get("a")).toContain("Đá/Nóng: Nóng");expect(parents[0].totalAmount).toBe(50000);
 });
 it("fails instead of exporting incomplete options or denied item data",async()=>{
  mock.details.mockResolvedValue(new Map());await expect(getFnbInvoiceExportDetails(parents)).rejects.toThrow("Chưa tải đủ");mock.fail=true;await expect(getFnbInvoiceExportDetails(parents)).rejects.toThrow("denied");
 });
 it("stops after cancellation and skips Retail invoices",async()=>{
  const ctl=new AbortController();ctl.abort();await expect(getFnbInvoiceExportDetails(parents,ctl.signal)).rejects.toThrow("hủy");expect(mock.details).not.toHaveBeenCalled();
  expect((await getFnbInvoiceExportDetails([{...parents[0],source:"pos"}])).items).toEqual([]);
 });
});
