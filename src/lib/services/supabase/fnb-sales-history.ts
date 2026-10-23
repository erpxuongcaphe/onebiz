import {getFnbInvoiceItemNotes} from "./fnb-invoice-item-notes";
import {readFnbInvoiceContext, FNB_ORDER_CONTEXT_SELECT} from "@/lib/utils/fnb-invoice-context";
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
interface InvoiceRow { id: string; code: string; customer_name: string; total: number; paid: number; tip_amount: number; payment_method: string; ngay_chung_tu: string; created_at: string; status: string; discount_amount: number; note: string | null; created_by: string; fnb_context?: unknown }
interface KitchenRow { id: string; invoice_id: string | null; order_number: string; order_type: string; status: string; created_at: string; customer_name: string | null; note: string | null; created_by: string; merged_into_id: string | null; restaurant_tables: { name: string; table_number: string; zone?: string; floor_plan_zones?: {name:string} | null } | null }
export interface FnbDayHistory { rows: FnbSaleRow[] }
/** One business day, explicit tenant + branch, all headers (not a 50-row subtotal). No writes. */
export async function getFnbDayHistory(branchId: string, day: string): Promise<FnbDayHistory> {
  if (!branchId) throw new Error("Chọn chi nhánh trước khi xem lịch sử.");
  const db = getClient(), tenant = await getCurrentTenantId(), range = fnbDayRange(day);
  const kitchenSelect = `${FNB_ORDER_CONTEXT_SELECT},status,customer_name,created_by,merged_into_id`;
  const [invoices, kitchenDay] = await Promise.all([
    readHistoryPages<InvoiceRow>(async (offset, size) => {
      const result = await db.from("invoices").select("id,code,customer_name,total,paid,tip_amount,payment_method,ngay_chung_tu,created_at,status,discount_amount,note,created_by,fnb_context", {count:"exact"})
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
    const context=readFnbInvoiceContext({...row,source:"fnb"},ko);
    return {...context,id:row.id,invoiceId:row.id,code:row.code,customerName:row.customer_name || "Khách lẻ",total:Number(row.total),paid:Number(row.paid),tipAmount:Number(row.tip_amount ?? 0),paymentMethod:row.payment_method,
      createdAt:row.ngay_chung_tu,recordedAt:row.created_at,kitchenOrderId:ko?.id ?? null,kitchenOrderNumber:ko?.order_number ?? null,tableName:context.tableName ?? (context.tableNumber ? `Bàn ${context.tableNumber}` : null),orderType:ko?.order_type ?? "takeaway",
      status:row.status as "completed"|"cancelled",discount:Number(row.discount_amount ?? 0),note:row.note,cashierName:staff.get(row.created_by) ?? "—"};
  });
  for(const ko of kitchenDay) {
    if(ko.invoice_id || ko.merged_into_id || ko.status === "completed") continue;
    rows.push({...readFnbInvoiceContext({source:"fnb"},ko),id:ko.id,invoiceId:null,code:ko.order_number,customerName:ko.customer_name || "Khách lẻ",total:0,paid:0,tipAmount:0,paymentMethod:"",createdAt:ko.created_at,recordedAt:ko.created_at,kitchenOrderId:ko.id,kitchenOrderNumber:ko.order_number,tableName:ko.restaurant_tables?.name ?? ko.restaurant_tables?.table_number ?? null,orderType:ko.order_type,status:ko.status === "cancelled" ? "cancelled" : "pending",discount:0,note:ko.note,cashierName:staff.get(ko.created_by) ?? "—"});
  }
  rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  return {rows};
}
export interface FnbDayCash { received: number; refunded: number; net: number; methods: Record<string,number>; completed: number; pending: number; cancelled: number; invoiceValue: number }
/** Aggregates are computed in the database after explicit permission + branch checks. */
export async function getFnbDayCash(branchId:string,day:string):Promise<FnbDayCash> {
  fnbDayRange(day);
  if(!branchId) throw new Error("Thiếu chi nhánh.");
  const {data,error}=await getClient().rpc("get_fnb_day_sales_summary",{p_branch_id:branchId,p_day:day});
  if(error) handleError(error,"fnbHistory.summary");
  if(!data || typeof data!=="object" || Array.isArray(data)) throw new Error("Không tải được tổng thu F&B.");
  return data as unknown as FnbDayCash;
}

export interface FnbHistoryItem {id:string;name:string;quantity:number;unitPrice:number;total:number;note:string}
export async function getFnbHistoryItems(row:FnbSaleRow,branchId:string):Promise<FnbHistoryItem[]> {
  const db=getClient(),tenant=await getCurrentTenantId();
  // Verify the selected record is still in this branch before fetching scoped children.
  const parent=await db.from(row.invoiceId ? "invoices" : "kitchen_orders").select("id").eq("id",row.id).eq("tenant_id",tenant).eq("branch_id",branchId).single();
  if(parent.error) handleError(parent.error,"fnbHistory.detail");
  const result=row.invoiceId ? await db.from("invoice_items_scoped").select("id,product_name,quantity,unit_price,total,note").eq("invoice_id",row.invoiceId) : await db.from("kitchen_order_items").select("id,product_name,quantity,unit_price,note,variant_label,cancelled_qty").eq("kitchen_order_id",row.id);
  if(result.error) handleError(result.error,"fnbHistory.items");
  const notes=row.invoiceId && result.data?.length ? await getFnbInvoiceItemNotes(row.invoiceId) : new Map<string,string>();
  return (result.data ?? []).map(value=>{
    const item=value as unknown as Record<string,unknown>;
    const quantity=Number(item.quantity ?? 0), price=Number(item.unit_price ?? 0);
    return {id:String(item.id),name:String(item.product_name ?? "—"),quantity,unitPrice:price,total:Number(item.total ?? quantity*price),note:[item.variant_label,item.note ?? notes.get(String(item.id)),Number(item.cancelled_qty ?? 0)>0 ? `Đã hủy ${item.cancelled_qty}` : null].filter(Boolean).join(" · ")};
  });
}
