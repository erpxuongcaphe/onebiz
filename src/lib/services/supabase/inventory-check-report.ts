/**
 * Báo cáo kiểm kê tổng hợp — Sprint KK-DETAIL (CEO 06/05/2026).
 *
 * CEO yêu cầu: số liệu chi tiết để có hướng xử lý
 *   - Số phiếu kiểm trong kỳ
 *   - Tổng giá trị lệch tăng / lệch giảm / net (thiệt hại)
 *   - So sánh kỳ này vs kỳ trước (variance %)
 *   - Top SP lệch nhiều nhất
 *   - Theo người thực hiện
 */

import { getClient, getCurrentTenantId, handleError } from "./base";
import type { DateRange } from "@/lib/types/report";

export interface InventoryCheckReportRow {
  id: string;
  code: string;
  date: string;
  branchId: string | null;
  branchName: string;
  status: string;
  createdByName: string;
  totalProducts: number;
  totalIncrease: number;
  totalDecrease: number;
  netImpact: number;
}

export interface InventoryCheckReportSummary {
  totalChecks: number;
  totalIncrease: number;
  totalDecrease: number;
  netImpact: number;
  prevTotalChecks: number;
  prevTotalIncrease: number;
  prevTotalDecrease: number;
  prevNetImpact: number;
}

export interface InventoryCheckReportResult {
  summary: InventoryCheckReportSummary;
  rows: InventoryCheckReportRow[];
  range: DateRange;
}

interface Options {
  range: DateRange;
  branchId?: string;
}

/**
 * Get inventory check report.
 *
 * Strategy:
 * - Fetch inventory_checks trong kỳ (status='balanced' để có ảnh hưởng thực)
 * - Aggregate per check: total products, total increase/decrease/net
 * - Tính summary KPI + previous period (same length backward) cho %
 *   change.
 */
export async function getInventoryCheckReport(
  options: Options,
): Promise<InventoryCheckReportResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { range, branchId } = options;

  const fromIso = `${range.from}T00:00:00+07:00`;
  const toIso = `${range.to}T23:59:59+07:00`;

  // Previous period (same length backward)
  const fromDate = new Date(fromIso);
  const toDate = new Date(toIso);
  const lengthMs = toDate.getTime() - fromDate.getTime();
  const prevTo = new Date(fromDate.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - lengthMs);

  // 1. Fetch checks current period
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("inventory_checks")
    .select(
      "id, code, created_at, branch_id, status, profiles!inventory_checks_created_by_fkey(full_name), branches(name), inventory_check_items(id, difference, products(cost_price))",
    )
    .eq("tenant_id", tenantId)
    .gte("created_at", fromIso)
    .lte("created_at", toIso);
  if (branchId) query = query.eq("branch_id", branchId);
  const { data: checks, error } = await query;
  if (error) handleError(error, "getInventoryCheckReport.checks");

  // 2. Build rows + aggregate
  let totalIncrease = 0;
  let totalDecrease = 0;
  const rows: InventoryCheckReportRow[] = (checks ?? []).map(
    (c: Record<string, unknown>) => {
      const items = (c.inventory_check_items as Array<{
        difference: number;
        products?: { cost_price?: number | null } | null;
      }>) ?? [];
      let inc = 0;
      let dec = 0;
      for (const it of items) {
        const v = Number(it.difference ?? 0) * Number(it.products?.cost_price ?? 0);
        if (v > 0) inc += v;
        else if (v < 0) dec += Math.abs(v);
      }
      totalIncrease += inc;
      totalDecrease += dec;
      const profile = c.profiles as { full_name?: string } | null;
      const branch = c.branches as { name?: string } | null;
      return {
        id: c.id as string,
        code: c.code as string,
        date: c.created_at as string,
        branchId: (c.branch_id as string) ?? null,
        branchName: branch?.name ?? "—",
        status: c.status as string,
        createdByName: profile?.full_name ?? "—",
        totalProducts: items.length,
        totalIncrease: inc,
        totalDecrease: dec,
        netImpact: inc - dec,
      };
    },
  );

  // 3. Previous period summary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prevQuery = (supabase as any)
    .from("inventory_checks")
    .select("id, inventory_check_items(difference, products(cost_price))")
    .eq("tenant_id", tenantId)
    .gte("created_at", prevFrom.toISOString())
    .lt("created_at", prevTo.toISOString());
  if (branchId) prevQuery = prevQuery.eq("branch_id", branchId);
  const { data: prevChecks } = await prevQuery;

  let prevInc = 0;
  let prevDec = 0;
  for (const pc of prevChecks ?? []) {
    const items = (pc as {
      inventory_check_items?: Array<{
        difference: number;
        products?: { cost_price?: number | null } | null;
      }>;
    })
      .inventory_check_items ?? [];
    for (const it of items) {
      const v = Number(it.difference ?? 0) * Number(it.products?.cost_price ?? 0);
      if (v > 0) prevInc += v;
      else if (v < 0) prevDec += Math.abs(v);
    }
  }

  return {
    summary: {
      totalChecks: rows.length,
      totalIncrease,
      totalDecrease,
      netImpact: totalIncrease - totalDecrease,
      prevTotalChecks: (prevChecks ?? []).length,
      prevTotalIncrease: prevInc,
      prevTotalDecrease: prevDec,
      prevNetImpact: prevInc - prevDec,
    },
    rows,
    range,
  };
}
