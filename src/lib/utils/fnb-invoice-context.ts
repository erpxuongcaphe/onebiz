import { formatDate } from "@/lib/format";
export interface FnbInvoiceContext {
  tableName?: string | null; tableNumber?: string; areaName?: string;
  openedAt?: string; paidAt?: string; posNote?: string;
}
type Row = Record<string, unknown>;
const object = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : undefined;
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(String(v))) ? String(v) : undefined;
export function readFnbInvoiceContext(invoice: Row, orderValue?: unknown): FnbInvoiceContext {
  if (invoice.source !== "fnb") return {};
  const snapshot=object(invoice.fnb_context);
  // Null fields in a captured snapshot are deliberate; never replace them with today's table/note.
  const captured=snapshot.version===1;
  const order=object(orderValue), table=object(order.restaurant_tables), zone=object(table.floor_plan_zones);
  const number=captured ? snapshot.table_number : table.table_number;
  return {
    tableName:text(captured ? snapshot.table_name : table.name),
    tableNumber:typeof number === "number" || typeof number === "string" ? String(number) : undefined,
    areaName:text(captured ? snapshot.area_name : zone.name) ?? (captured ? undefined : text(table.zone)),
    openedAt:date(captured ? snapshot.opened_at : order.created_at),
    // F&B invoices are inserted by atomic payment, unlike editable business/document dates.
    paidAt:date(captured ? snapshot.paid_at : invoice.created_at),
    posNote:text(captured ? snapshot.pos_note : order.note),
  };
}
export const FNB_ORDER_CONTEXT_SELECT="id,invoice_id,order_number,order_type,created_at,note,restaurant_tables!kitchen_orders_table_id_fkey(name,table_number,zone,floor_plan_zones!restaurant_tables_zone_fkey(name))";
export const fnbContextExportColumns = [
  {header:"Bàn",key:"tableName",width:18},
  {header:"Số bàn",key:"tableNumber",width:12},
  {header:"Khu vực",key:"areaName",width:22},
  {header:"Giờ khách vào",key:"openedAt",width:23,format:(v: string)=>formatDate(v)},
  {header:"Giờ khách về",key:"paidAt",width:23,format:(v: string)=>formatDate(v)},
  {header:"Ghi chú POS",key:"posNote",width:45},
];
