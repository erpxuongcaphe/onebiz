import { beforeEach, describe, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({tables:{} as Record<string,Record<string,unknown>[]>,calls:[] as {table:string;op:string;args:unknown[]}[],fail:""}));
vi.mock("@/lib/services/supabase/base",()=>({getCurrentTenantId:async()=>"tenant",handleError:(error:{message:string})=>{throw new Error(error.message);},getClient:()=>({from:(table:string)=>{
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
  const result=await getFnbDayHistory("xtb","2026-10-20");expect(result.completed).toBe(241);expect(result.invoiceValue).toBe(24100);expect(result.rows).toHaveLength(241);
  expect(mock.calls.filter(call=>call.table==="invoices"&&call.op==="range").length).toBe(2);
 });
 it("counts a paid bill once, excludes merged orders, keeps pending and cancelled separate",async()=>{
  mock.tables.invoices=[inv("paid"),inv("void","cancelled")];
  mock.tables.kitchen_orders=[ko("paid-ko","paid","completed"),ko("void-ko","void","cancelled"),ko("open"),ko("cancel",null,"cancelled"),{...ko("merged"),merged_into_id:"open"}];
  const result=await getFnbDayHistory("xtb","2026-10-20");expect(result.completed).toBe(1);expect(result.pending).toBe(1);expect(result.cancelled).toBe(2);expect(result.invoiceValue).toBe(100);expect(result.rows.find(row=>row.id==="paid")?.cashierName).toBe("Thu ngân");
 });
 it("resolves the table for an order opened yesterday but settled today",async()=>{
  mock.tables.invoices=[inv("paid")];mock.tables.kitchen_orders=[{...ko("ko","paid","completed"),created_at:"2026-10-19T01:00:00.000Z",restaurant_tables:{name:"TN08"}}];
  expect((await getFnbDayHistory("xtb","2026-10-20")).rows[0].tableName).toBe("TN08");
 });
 it("uses cash posting day, original methods, and refunds, excluding Retail and cancelled cash",async()=>{
  mock.tables.invoices=[{...inv("late"),ngay_chung_tu:"2026-10-19T01:00:00Z"},inv("void","cancelled"),{...inv("retail"),source:"pos"}];
  const cash=(id:string,ref:string,amount:number,type="receipt",method="cash")=>({id,tenant_id:"tenant",branch_id:"xtb",transaction_date:"2026-10-20",status:"completed",reference_id:ref,reference_type:type==="receipt"?"invoice":"invoice_void",amount,type,payment_method:method});
  mock.tables.cash_transactions=[cash("1","late",60),cash("2","late",40,"receipt","transfer"),cash("3","void",25,"payment","transfer"),cash("4","retail",999),{...cash("5","late",999),status:"cancelled"}];
  expect(await getFnbDayCash("xtb","2026-10-20")).toEqual({received:100,refunded:25,net:75,methods:{cash:60,transfer:15}});
 });
 it("fails visibly on denied reads and verifies branch before loading items",async()=>{
  mock.fail="invoices";await expect(getFnbDayHistory("xtb","2026-10-20")).rejects.toThrow("Không được đọc");mock.fail="";
  mock.tables.invoices=[inv("bill")];const row=(await getFnbDayHistory("xtb","2026-10-20")).rows[0];
  await expect(getFnbHistoryItems(row,"other")).rejects.toThrow("Sai phạm vi");
  expect(mock.calls.some(call=>call.table==="invoice_items_scoped")).toBe(false);
 });
});
