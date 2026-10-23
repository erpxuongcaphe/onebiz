import { beforeEach, describe, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({tables:{} as Record<string,Record<string,unknown>[]>,calls:[] as {table:string;op:string;args:unknown[]}[],fail:"",rpc:vi.fn()}));
vi.mock("@/lib/services/supabase/base",()=>({getCurrentTenantId:async()=>"tenant",handleError:(error:{message:string})=>{throw new Error(error.message);},getClient:()=>({rpc:mock.rpc,from:(table:string)=>{
 let rows=[...(mock.tables[table]??[])],from=0,to=Infinity,single=false;
 const q:Record<string,unknown>={};
 for(const op of ["select","eq","is","in","gte","lt","order","range","single"]) q[op]=(...args:unknown[])=>{
  mock.calls.push({table,op,args});const [key,value]=args;
  if(op==="eq"||op==="is")rows=rows.filter(row=>row[String(key)]===value);
  if(op==="in")rows=rows.filter(row=>(value as unknown[]).includes(row[String(key)]));
  if(op==="gte")rows=rows.filter(row=>String(row[String(key)])>=String(value));
  if(op==="lt")rows=rows.filter(row=>String(row[String(key)])<String(value));
  if(op==="range"){from=Number(key);to=Number(value);}
  if(op==="single")single=true;
  return q;
 };
 q.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:single ? rows[0]??null : rows.slice(from,to+1),count:rows.length,error:mock.fail===table?{message:"Không được đọc"}:single&&!rows.length?{message:"Sai phạm vi"}:null}).then(resolve);
 return q;
}})}));
import { fnbDayRange,getFnbDayHistory,getFnbDayCash,getFnbHistoryItems } from "@/lib/services/supabase/fnb-sales-history";
const inv=(id:string,status="completed")=>({id,tenant_id:"tenant",branch_id:"xtb",source:"fnb",deleted_at:null,code:id,customer_name:"Khách",total:100,paid:100,tip_amount:0,payment_method:"cash",ngay_chung_tu:"2026-10-20T01:00:00.000Z",created_at:"2026-10-20T01:00:00.000Z",status,discount_amount:0,created_by:"u"});
const ko=(id:string,invoice_id:string|null=null,status="pending")=>({id,tenant_id:"tenant",branch_id:"xtb",invoice_id,order_number:id,order_type:"dine_in",status,created_at:"2026-10-20T01:00:00.000Z",created_by:"u",merged_into_id:null});
beforeEach(()=>{mock.calls=[];mock.fail="";mock.tables={invoices:[],kitchen_orders:[],profiles:[{id:"u",tenant_id:"tenant",full_name:"Thu ngân"}],cash_transactions:[]};});
describe("F&B sales history boundaries",()=>{
 it("uses Vietnam midnight with exclusive next day, rejecting impossible dates",()=>{
  expect(fnbDayRange("2026-10-20")).toEqual({from:"2026-10-19T17:00:00.000Z",to:"2026-10-20T17:00:00.000Z"});
  expect(()=>fnbDayRange("2026-02-30")).toThrow();
 });
 it("reads all 241 bills, excludes Retail, other branch, deleted and next-day data",async()=>{
  mock.tables.invoices=[...Array.from({length:241},(_,i)=>inv(String(i))),{...inv("retail"),source:"pos"},{...inv("other"),branch_id:"other"},{...inv("deleted"),deleted_at:"2026-10-20"},{...inv("tomorrow"),ngay_chung_tu:"2026-10-20T17:00:00.000Z"}];
  const result=await getFnbDayHistory("xtb","2026-10-20");expect(result).not.toHaveProperty("invoiceValue");expect(result.rows).toHaveLength(241);
  expect(mock.calls.filter(call=>call.table==="invoices"&&call.op==="range").length).toBe(2);
 });
 it("counts a paid bill once, excludes merged orders, keeps pending and cancelled separate",async()=>{
  mock.tables.invoices=[inv("paid"),inv("void","cancelled")];
  mock.tables.kitchen_orders=[ko("paid-ko","paid","completed"),ko("void-ko","void","cancelled"),ko("open"),ko("cancel",null,"cancelled"),{...ko("merged"),merged_into_id:"open"}];
  const result=await getFnbDayHistory("xtb","2026-10-20");expect(result.rows.map(row=>row.status).sort()).toEqual(["cancelled","cancelled","completed","pending"]);expect(result.rows.find(row=>row.id==="paid")?.cashierName).toBe("Thu ngân");
 });
 it("resolves the table for an order opened yesterday but settled today",async()=>{
  mock.tables.invoices=[inv("paid")];mock.tables.kitchen_orders=[{...ko("ko","paid","completed"),created_at:"2026-10-19T01:00:00.000Z",restaurant_tables:{name:"TN08"}}];
  expect((await getFnbDayHistory("xtb","2026-10-20")).rows[0].tableName).toBe("TN08");
 });
 it("preserves paid table/area/times/POS note snapshot after order changes",async()=>{
  const snapshot={version:1,table_name:"TN 03",table_number:3,area_name:"Trong nhà",opened_at:"2026-10-19T14:00:00Z",paid_at:"2026-10-20T01:00:00Z",pos_note:"Lấy thêm ly"};
  mock.tables.invoices=[{...inv("paid"),fnb_context:snapshot}];mock.tables.kitchen_orders=[{...ko("ko","paid","completed"),note:"Edited",restaurant_tables:{name:"Renamed"}}];
  expect((await getFnbDayHistory("xtb","2026-10-20")).rows[0]).toMatchObject({tableName:"TN 03",tableNumber:"3",areaName:"Trong nhà",openedAt:snapshot.opened_at,paidAt:snapshot.paid_at,posNote:"Lấy thêm ly"});
 });
 it("loads aggregate data only through the guarded server RPC",async()=>{
  const summary={received:100,refunded:25,net:75,methods:{cash:60,transfer:15},completed:1,pending:0,cancelled:1,invoiceValue:100};
  mock.rpc.mockResolvedValue({data:summary,error:null});
  expect(await getFnbDayCash("xtb","2026-10-20")).toEqual(summary);
  expect(mock.rpc).toHaveBeenCalledWith("get_fnb_day_sales_summary",{p_branch_id:"xtb",p_day:"2026-10-20"});
  expect(mock.calls).toHaveLength(0);
  mock.rpc.mockResolvedValue({data:null,error:{message:"FNB_SALES_SUMMARY_PERMISSION_DENIED"}});
  await expect(getFnbDayCash("xtb","2026-10-20")).rejects.toThrow("PERMISSION_DENIED");
 });
 it("fails visibly on denied reads and verifies branch before loading items",async()=>{
  mock.fail="invoices";await expect(getFnbDayHistory("xtb","2026-10-20")).rejects.toThrow("Không được đọc");mock.fail="";
  mock.tables.invoices=[inv("bill")];const row=(await getFnbDayHistory("xtb","2026-10-20")).rows[0];
  await expect(getFnbHistoryItems(row,"other")).rejects.toThrow("Sai phạm vi");
  expect(mock.calls.some(call=>call.table==="invoice_items_scoped")).toBe(false);
 });
});
