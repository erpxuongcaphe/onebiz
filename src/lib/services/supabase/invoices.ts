/**
 * Supabase service: Invoices
 */

import type { Invoice, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError } from "./base";

export async function getInvoices(params: QueryParams): Promise<QueryResult<Invoice>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("invoices")
    .select("*, profiles!invoices_created_by_fkey(full_name)", { count: "exact" });

  // Search
  if (params.search) {
    query = query.or(`code.ilike.%${params.search}%,customer_name.ilike.%${params.search}%`);
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", params.filters.status as any);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getInvoices");

  const invoices: Invoice[] = (data ?? []).map(mapInvoice);
  return { data: invoices, total: count ?? 0 };
}

export function getInvoiceStatuses() {
  // Static statuses - could be enhanced with counts from DB
  return [
    { label: "Hoàn thành", value: "completed", count: 0 },
    { label: "Đang xử lý", value: "confirmed", count: 0 },
    { label: "Phiếu tạm", value: "draft", count: 0 },
    { label: "Đã hủy", value: "cancelled", count: 0 },
  ];
}

// --- Mapper ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInvoice(row: any): Invoice {
  const statusMap: Record<string, string> = {
    draft: "processing",
    confirmed: "processing",
    completed: "completed",
    cancelled: "cancelled",
  };

  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    customerId: row.customer_id ?? "",
    customerCode: "", // Would need join to customers table
    customerName: row.customer_name,
    totalAmount: row.total,
    discount: row.discount_amount,
    status: (statusMap[row.status] ?? row.status) as Invoice["status"],
    deliveryType: "no_delivery", // Would need join to shipping_orders
    createdBy: (row.profiles as { full_name: string } | null)?.full_name ?? "---",
  };
}
