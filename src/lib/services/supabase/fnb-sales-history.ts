import { getClient, getCurrentTenantId, handleError } from "./base";
import { readHistoryPages } from "./read-history-pages";
import type { FnbRecentInvoice } from "./invoices";
import { cashDateTimeInput } from "@/lib/cash-time";

export const todayFnb = () => cashDateTimeInput(new Date()).slice(0, 10);
export function fnbDayRange(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Chọn ngày hợp lệ.");
  const from = new Date(day + "T00:00:00+07:00");
  if (!Number.isFinite(from.getTime()) || cashDateTimeInput(from).slice(0, 10) !== day) throw new Error("Ngày không hợp lệ.");
  return { from: from.toISOString(), to: new Date(from.getTime() + 86400000).toISOString() };
}
export interface FnbSaleRow extends FnbRecentInvoice {
  status: "completed" | "pending" | "cancelled";
  invoiceId: string | null;
  discount: number;
  note: string | null;
  recordedAt: string;
  cashierName: string;
}
interface InvoiceRow { id: string; code: string; customer_name: string; total: number; paid: number; tip_amount: number; payment_method: string; ngay_chung_tu: string; created_at: string; status: string; discount_amount: number; note: string | null; created_by: string }
interface KitchenRow { id: string; invoice_id: string | null; order_number: string; order_type: string; status: string; created_at: string; customer_name: string | null; note: string | null; created_by: string; merged_into_id: string | null; restaurant_tables: { name: string; table_number: string } | null }
export interface FnbDayHistory { rows: FnbSaleRow[]; completed: number; pending: number; cancelled: number; invoiceValue: number }
/** One business day, explicit tenant + branch, all headers (not a 50-row subtotal). No writes. */
export async function getFnbDayHistory(branchId: string, day: string): Promise<FnbDayHistory> {
  if (!branchId) throw new Error("Chọn chi nhánh trước khi xem lịch sử.");
  const db = getClient(), tenant = await getCurrentTenantId(), range = fnbDayRange(day);
  const kitchenSelect = "id,invoice_id,order_number,order_type,status,created_at,customer_name,note,created_by,merged_into_id,restaurant_tables!kitchen_orders_table_id_fkey(name,table_number)";
  const [invoices, kitchenDay] = await Promise.all([
    readHistoryPages<InvoiceRow>(async (offset, size) => {
      const result = await db.from("invoices").select("id,code,customer_name,total,paid,tip_amount,payment_method,ngay_chung_tu,created_at,status,discount_amount,note,created_by", {count:"exact"})
        .eq("tenant_id", tenant).eq("branch_id", branchId).eq("source", "fnb").is("deleted_at", null)
        .in("status", ["completed", "cancelled"]).gte("ngay_chung_tu", range.from).lt("ngay_chung_tu", range.to)
        .order("ngay_chung_tu", {ascending:false}).order("id").range(offset, offset + size - 1);
      return {...result, data: result.data as unknown as InvoiceRow[] | null};
    }),
    readHistoryPages<KitchenRow>(async (offset, size) => {
      const result = await db.from("kitchen_orders").select(kitchenSelect, {count:"exact"}).eq("tenant_id",tenant).eq("branch_id",branchId)
        .gte("created_at",range.from).lt("created_at",range.to).order("id").range(offset,offset+size-1);
      return {...result, data: result.data as unknown as KitchenRow[] | null};
    }),
  ]);
  const kitchen = new Map(kitchenDay.map(row => [row.id, row]));
  // Orders may have been opened yesterday and settled today.
  for (let i=0; i<invoices.length; i+=100) {
    const result = await db.from("kitchen_orders").select(kitchenSelect).eq("tenant_id",tenant).eq("branch_id",branchId).in("invoice_id",invoices.slice(i,i+100).map(row=>row.id));
    if (result.error) handleError(result.error,"fnbHistory.orders");
    for (const row of (result.data ?? []) as unknown as KitchenRow[]) kitchen.set(row.id,row);
  }
  const staffIds=[...new Set([...invoices.map(row=>row.created_by),...kitchenDay.map(row=>row.created_by)])];
  const staff = new Map<string,string>();
  for (let i=0;i<staffIds.length;i+=100) {
    const result=await db.from("profiles").select("id,full_name").eq("tenant_id",tenant).in("id",staffIds.slice(i,i+100));
    if (result.error) handleError(result.error,"fnbHistory.staff");
    for(const row of result.data ?? []) staff.set(row.id,row.full_name ?? "—");
  }
  const byInvoice=new Map([...kitchen.values()].filter(row=>row.invoice_id).map(row=>[row.invoice_id,row]));
  const rows: FnbSaleRow[]=invoices.map(row=>{
    const ko=byInvoice.get(row.id);
    return {id:row.id,invoiceId:row.id,code:row.code,customerName:row.customer_name || "Khách lẻ",total:Number(row.total),paid:Number(row.paid),tipAmount:Number(row.tip_amount ?? 0),paymentMethod:row.payment_method,
      createdAt:row.ngay_chung_tu,recordedAt:row.created_at,kitchenOrderId:ko?.id ?? null,kitchenOrderNumber:ko?.order_number ?? null,tableName:ko?.restaurant_tables?.name ?? ko?.restaurant_tables?.table_number ?? null,orderType:ko?.order_type ?? "takeaway",
      status:row.status as "completed"|"cancelled",discount:Number(row.discount_amount ?? 0),note:row.note,cashierName:staff.get(row.created_by) ?? "—"};
  });
  for(const ko of kitchenDay) {
    if(ko.invoice_id || ko.merged_into_id || ko.status === "completed") continue;
    rows.push({id:ko.id,invoiceId:null,code:ko.order_number,customerName:ko.customer_name || "Khách lẻ",total:0,paid:0,tipAmount:0,paymentMethod:"",createdAt:ko.created_at,recordedAt:ko.created_at,kitchenOrderId:ko.id,kitchenOrderNumber:ko.order_number,tableName:ko.restaurant_tables?.name ?? ko.restaurant_tables?.table_number ?? null,orderType:ko.order_type,status:ko.status === "cancelled" ? "cancelled" : "pending",discount:0,note:ko.note,cashierName:staff.get(ko.created_by) ?? "—"});
  }
  rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  return {rows,completed:rows.filter(row=>row.status==="completed").length,pending:rows.filter(row=>row.status==="pending").length,cancelled:rows.filter(row=>row.status==="cancelled").length,invoiceValue:rows.filter(row=>row.status==="completed").reduce((sum,row)=>sum+row.total,0)};
}
export interface FnbDayCash { received: number; refunded: number; net: number; methods: Record<string,number> }
/** Cash follows the ledger posting date, independent of the invoice business date. */
export async function getFnbDayCash(branchId:string,day:string):Promise<FnbDayCash> {
  fnbDayRange(day);
  if(!branchId) throw new Error("Thiếu chi nhánh.");
  const db=getClient(),tenant=await getCurrentTenantId();
  const cash=await readHistoryPages<{id:string;reference_id:string|null;amount:number;type:string;payment_method:string}>(async(offset,size)=>await db.from("cash_transactions")
    .select("id,reference_id,amount,type,payment_method",{count:"exact"}).eq("tenant_id",tenant).eq("branch_id",branchId).eq("status","completed")
    .in("reference_type",["invoice","invoice_void"]).eq("transaction_date",day).order("id").range(offset,offset+size-1));
  const ids=[...new Set(cash.flatMap(row=>row.reference_id ? [row.reference_id] : []))],fnb=new Set<string>();
  for(let i=0;i<ids.length;i+=100) {
    const result=await db.from("invoices").select("id").eq("tenant_id",tenant).eq("branch_id",branchId).eq("source","fnb").in("id",ids.slice(i,i+100));
    if(result.error) handleError(result.error,"fnbHistory.cashInvoices");
    for(const row of result.data ?? []) fnb.add(row.id);
  }
  const summary:FnbDayCash={received:0,refunded:0,net:0,methods:{}};
  for(const row of cash) if(row.reference_id && fnb.has(row.reference_id)) {
    const amount=Number(row.amount),signed=row.type==="receipt" ? amount : -amount;
    if(row.type==="receipt") summary.received+=amount; else summary.refunded+=amount;
    summary.net+=signed; summary.methods[row.payment_method]=(summary.methods[row.payment_method]??0)+signed;
  }
  return summary;
}
export interface FnbHistoryItem {id:string;name:string;quantity:number;unitPrice:number;total:number;note:string}
export async function getFnbHistoryItems(row:FnbSaleRow,branchId:string):Promise<FnbHistoryItem[]> {
  const db=getClient(),tenant=await getCurrentTenantId();
  // Verify the selected record is still in this branch before fetching scoped children.
  const parent=await db.from(row.invoiceId ? "invoices" : "kitchen_orders").select("id").eq("id",row.id).eq("tenant_id",tenant).eq("branch_id",branchId).single();
  if(parent.error) handleError(parent.error,"fnbHistory.detail");
  const result=row.invoiceId ? await db.from("invoice_items_scoped").select("*").eq("invoice_id",row.invoiceId) : await db.from("kitchen_order_items").select("*").eq("kitchen_order_id",row.id);
  if(result.error) handleError(result.error,"fnbHistory.items");
  return (result.data ?? []).map(value=>{
    const item=value as unknown as Record<string,unknown>;
    const quantity=Number(item.quantity ?? 0), price=Number(item.unit_price ?? 0);
    return {id:String(item.id),name:String(item.product_name ?? "—"),quantity,unitPrice:price,total:Number(item.total ?? quantity*price),note:[item.variant_label,item.note,Number(item.cancelled_qty ?? 0)>0 ? `Đã hủy ${item.cancelled_qty}` : null].filter(Boolean).join(" · ")};
  });
}
