/**
 * ABC Analysis + Slow movers — REP-3 (CEO 06/05/2026).
 *
 * Pareto 80/15/5:
 * - A: 80% doanh thu (top SP)
 * - B: 15% doanh thu kế tiếp
 * - C: 5% doanh thu cuối
 * - Slow movers: SP doanh thu = 0 trong kỳ
 *
 * Quyết định kinh doanh:
 * - A: Stock buffer cao, ưu tiên display, đảm bảo không hết hàng
 * - B: Stock vừa
 * - C: Cân nhắc cắt SKU nếu margin thấp
 * - Slow: Khuyến mãi xả / cắt
 */

import { getClient, getCurrentTenantId, handleError } from "./base";
import type { DateRange } from "@/lib/types/report";

export type AbcClass = "A" | "B" | "C" | "slow";

export interface AbcRow {
  productId: string;
  code: string;
  name: string;
  unit: string;
  qtySold: number;
  revenue: number;
  /** Cumulative % doanh thu (đã sort desc) */
  cumPct: number;
  /** % của SP này trong tổng doanh thu */
  pct: number;
  abcClass: AbcClass;
  /** Số ngày cuối cùng có giao dịch bán */
  lastSoldDaysAgo: number | null;
}

export interface AbcReportResult {
  rows: AbcRow[];
  /** Phân loại stats */
  classStats: {
    A: { count: number; revenue: number; revenuePct: number };
    B: { count: number; revenue: number; revenuePct: number };
    C: { count: number; revenue: number; revenuePct: number };
    slow: { count: number };
  };
  totalRevenue: number;
  range: DateRange;
}

interface AbcOptions {
  range: DateRange;
  branchId?: string;
  /** % ngưỡng class A (default 80) */
  thresholdA?: number;
  /** % ngưỡng class B (default 95 — A+B = 95% → C = 5%) */
  thresholdB?: number;
}

/**
 * Get ABC analysis report.
 *
 * Strategy:
 * - Fetch all invoice_items trong kỳ + join product
 * - Aggregate qty + revenue per product
 * - Sort desc by revenue → cumulative % → classify
 * - Slow movers = products active KHÔNG có sales trong kỳ
 */
export async function getAbcReport(options: AbcOptions): Promise<AbcReportResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { range, branchId } = options;
  const thresholdA = options.thresholdA ?? 80;
  const thresholdB = options.thresholdB ?? 95;

  const fromIso = `${range.from}T00:00:00+07:00`;
  const toIso = `${range.to}T23:59:59+07:00`;

  // 1. Fetch all active products
  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id, code, name, unit")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (pErr) handleError(pErr, "getAbcReport.products");

  // 2. Fetch all invoice_items in range (joined with completed invoices)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let itemsQuery = (supabase as any)
    .from("invoice_items")
    .select(
      "product_id, product_name, quantity, total, invoices!inner(created_at, status, branch_id, tenant_id)",
    )
    .eq("invoices.tenant_id", tenantId)
    .eq("invoices.status", "completed")
    .gte("invoices.created_at", fromIso)
    .lte("invoices.created_at", toIso);
  if (branchId) itemsQuery = itemsQuery.eq("invoices.branch_id", branchId);
  const { data: items, error: iErr } = await itemsQuery;
  if (iErr) handleError(iErr, "getAbcReport.items");

  // 3. Aggregate
  const aggMap = new Map<
    string,
    { qty: number; revenue: number; lastSoldAt: string | null }
  >();
  for (const item of items ?? []) {
    const pid = item.product_id as string;
    const inv = item.invoices as { created_at: string };
    const existing = aggMap.get(pid) ?? {
      qty: 0,
      revenue: 0,
      lastSoldAt: null as string | null,
    };
    existing.qty += Number(item.quantity ?? 0);
    existing.revenue += Number(item.total ?? 0);
    if (
      !existing.lastSoldAt ||
      new Date(inv.created_at) > new Date(existing.lastSoldAt)
    ) {
      existing.lastSoldAt = inv.created_at;
    }
    aggMap.set(pid, existing);
  }

  // 4. Build rows + sort desc by revenue
  const productMap = new Map((products ?? []).map((p) => [p.id, p]));
  const totalRevenue = Array.from(aggMap.values()).reduce(
    (s, a) => s + a.revenue,
    0,
  );

  // Active products with sales
  const sold: AbcRow[] = [];
  let cumRevenue = 0;
  for (const [pid, agg] of Array.from(aggMap.entries()).sort(
    (a, b) => b[1].revenue - a[1].revenue,
  )) {
    const p = productMap.get(pid);
    if (!p) continue;
    const pct = totalRevenue > 0 ? (agg.revenue / totalRevenue) * 100 : 0;
    cumRevenue += agg.revenue;
    const cumPct = totalRevenue > 0 ? (cumRevenue / totalRevenue) * 100 : 0;
    const abcClass: AbcClass =
      cumPct <= thresholdA ? "A" : cumPct <= thresholdB ? "B" : "C";
    const lastSoldDaysAgo = agg.lastSoldAt
      ? Math.floor(
          (Date.now() - new Date(agg.lastSoldAt).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : null;
    sold.push({
      productId: pid,
      code: p.code,
      name: p.name,
      unit: p.unit ?? "",
      qtySold: agg.qty,
      revenue: agg.revenue,
      pct: Math.round(pct * 100) / 100,
      cumPct: Math.round(cumPct * 100) / 100,
      abcClass,
      lastSoldDaysAgo,
    });
  }

  // Slow movers (active products NOT in aggMap)
  const slow: AbcRow[] = [];
  for (const p of products ?? []) {
    if (aggMap.has(p.id)) continue;
    slow.push({
      productId: p.id,
      code: p.code,
      name: p.name,
      unit: p.unit ?? "",
      qtySold: 0,
      revenue: 0,
      pct: 0,
      cumPct: 0,
      abcClass: "slow",
      lastSoldDaysAgo: null,
    });
  }

  const rows = [...sold, ...slow];

  // Class stats
  const aRows = sold.filter((r) => r.abcClass === "A");
  const bRows = sold.filter((r) => r.abcClass === "B");
  const cRows = sold.filter((r) => r.abcClass === "C");
  const sumRev = (arr: AbcRow[]) => arr.reduce((s, r) => s + r.revenue, 0);

  return {
    rows,
    classStats: {
      A: {
        count: aRows.length,
        revenue: sumRev(aRows),
        revenuePct:
          totalRevenue > 0
            ? Math.round((sumRev(aRows) / totalRevenue) * 1000) / 10
            : 0,
      },
      B: {
        count: bRows.length,
        revenue: sumRev(bRows),
        revenuePct:
          totalRevenue > 0
            ? Math.round((sumRev(bRows) / totalRevenue) * 1000) / 10
            : 0,
      },
      C: {
        count: cRows.length,
        revenue: sumRev(cRows),
        revenuePct:
          totalRevenue > 0
            ? Math.round((sumRev(cRows) / totalRevenue) * 1000) / 10
            : 0,
      },
      slow: { count: slow.length },
    },
    totalRevenue,
    range,
  };
}
