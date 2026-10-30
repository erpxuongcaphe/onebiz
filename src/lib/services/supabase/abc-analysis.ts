import { getClient, getCurrentTenantId, handleError } from "./base";
import type { DateRange } from "@/lib/types/report";
import { toCreatedAtRangeWindow } from "@/lib/utils/list-date-preset-range";
import { buildAbcReport, type AbcProduct, type AbcSaleLine, type AbcReportResult } from "@/lib/reports/abc-model";
export type { AbcRow, AbcClass, AbcReportResult } from "@/lib/reports/abc-model";

interface AbcPagedQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}
async function fetchAllAbcRows<T>(buildQuery: () => AbcPagedQuery<T>, context: string): Promise<T[]> {
  const pageSize = 1000, rows: T[] = [];
  for (let offset = 0; offset <= 100000; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) { handleError(error, context); throw new Error("Không tải được nguồn báo cáo ABC."); }
    const page = data ?? [];
    rows.push(...page);
    if (rows.length > 100000) break;
    if (page.length < pageSize) return rows;
  }
  throw new Error("Kỳ báo cáo quá lớn. Vui lòng chọn khoảng thời gian ngắn hơn.");
}
interface AbcOptions { range: DateRange; branchId?: string; thresholdA?: number; thresholdB?: number }

export async function getAbcReport(options: AbcOptions): Promise<AbcReportResult> {
  const supabase = getClient(), tenantId = await getCurrentTenantId();
  const { range, branchId } = options;
  const window = toCreatedAtRangeWindow(range);
  if (!window || !Number.isFinite(Date.parse(window.start)) || Date.parse(window.start) >= Date.parse(window.end)) throw new Error("Kỳ báo cáo không hợp lệ.");
  // Inactive products remain necessary for historical sales.
  const products = await fetchAllAbcRows<AbcProduct>(() => supabase.from("products_scoped")
    .select("id, code, name, unit, is_active").eq("tenant_id", tenantId).order("id", { ascending: true }), "getAbcReport.products");
  let query = supabase.from("invoice_items_scoped")
    .select("product_id, product_name, quantity, total, unit, invoices!inner(ngay_chung_tu, status, branch_id, tenant_id)")
    .eq("invoices.tenant_id", tenantId).eq("invoices.status", "completed")
    .gte("invoices.ngay_chung_tu", window.start).lt("invoices.ngay_chung_tu", window.end);
  if (branchId && branchId !== "all") query = query.eq("invoices.branch_id", branchId);
  const items = await fetchAllAbcRows<AbcSaleLine>(() => query.order("id", { ascending: true }) as unknown as AbcPagedQuery<AbcSaleLine>, "getAbcReport.items");
  return buildAbcReport(products, items, range, options.thresholdA, options.thresholdB);
}
