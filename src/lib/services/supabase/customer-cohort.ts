/**
 * Customer Cohort Retention — REP-3 (CEO 06/05/2026).
 *
 * Cohort = nhóm KH có FIRST PURCHASE trong cùng tháng.
 * Retention = % cohort quay lại mua trong tháng N sau đó.
 *
 * Output matrix:
 *   Cohort       | Size | M0   | M1  | M2  | M3  | M4  | M5
 *   T1/2026      | 100  | 100% | 35% | 22% | 15% | 12% | 10%
 *   T2/2026      | 80   | 100% | 40% | 28% | 18% | ...
 *   ...
 *
 * Insight kinh doanh:
 * - M1 retention < 20% → có vấn đề với onboarding/sản phẩm
 * - M3+ retention > 30% → loyal cohort, khả năng LTV cao
 */

import { getClient, getCurrentTenantId, handleError } from "./base";

export interface CohortRow {
  /** Tháng cohort (vd "2026-01") */
  cohortMonth: string;
  /** Nhãn hiển thị (vd "T1/2026") */
  label: string;
  /** Size cohort (số KH lần đầu mua trong tháng đó) */
  size: number;
  /** % retention từ M0 đến M11 (M0 luôn 100%) */
  retention: number[];
}

export interface CohortReportResult {
  rows: CohortRow[];
  /** Số tháng cohort được track */
  monthsTracked: number;
}

/**
 * Get cohort retention report.
 *
 * Strategy:
 * - Fetch all completed invoices grouped by customer_id
 * - Per customer: find first_purchase_month + every active_month
 * - Group customers by first_purchase_month → cohort
 * - For each cohort × M_n → count active customers / cohort size
 *
 * @param months — Số tháng cohort (default 6)
 */
export async function getCustomerCohortReport(
  months: number = 6,
): Promise<CohortReportResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Fetch all invoices có customer_id (skip walk-in)
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("customer_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .not("customer_id", "is", null)
    .gte("created_at", startMonth.toISOString())
    .order("created_at", { ascending: true });
  if (error) handleError(error, "getCustomerCohortReport");

  // Build customer → first_purchase_month + active_months
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Inv = { customer_id: string; created_at: string };
  const customerMap = new Map<
    string,
    { firstMonth: string; activeMonths: Set<string> }
  >();

  for (const inv of (invoices ?? []) as Inv[]) {
    const cid = inv.customer_id;
    if (!cid) continue;
    const d = new Date(inv.created_at);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let entry = customerMap.get(cid);
    if (!entry) {
      entry = { firstMonth: monthKey, activeMonths: new Set() };
      customerMap.set(cid, entry);
    }
    if (monthKey < entry.firstMonth) entry.firstMonth = monthKey;
    entry.activeMonths.add(monthKey);
  }

  // Build cohort matrix
  const cohortKeys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    cohortKeys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  }

  // Group customers by first month
  const cohorts = new Map<string, Map<string, Set<string>>>();
  for (const cohortKey of cohortKeys) {
    cohorts.set(cohortKey, new Map());
  }

  for (const [cid, info] of customerMap.entries()) {
    if (!cohorts.has(info.firstMonth)) continue;
    const monthMap = cohorts.get(info.firstMonth)!;
    for (const am of info.activeMonths) {
      if (!monthMap.has(am)) monthMap.set(am, new Set());
      monthMap.get(am)!.add(cid);
    }
  }

  // Build rows
  const rows: CohortRow[] = [];
  for (const cohortKey of cohortKeys) {
    const cohortIdx = cohortKeys.indexOf(cohortKey);
    const monthMap = cohorts.get(cohortKey)!;
    const cohortSize = monthMap.get(cohortKey)?.size ?? 0;
    const retention: number[] = [];

    // For each subsequent month from cohort to current
    const remaining = months - cohortIdx;
    for (let n = 0; n < remaining; n++) {
      // monthN = cohort + n months
      const cohortDate = parseMonthKey(cohortKey);
      const targetDate = new Date(
        cohortDate.getFullYear(),
        cohortDate.getMonth() + n,
        1,
      );
      const targetKey = `${targetDate.getFullYear()}-${String(
        targetDate.getMonth() + 1,
      ).padStart(2, "0")}`;
      const activeCount = monthMap.get(targetKey)?.size ?? 0;
      const pct = cohortSize > 0 ? (activeCount / cohortSize) * 100 : 0;
      retention.push(Math.round(pct * 10) / 10);
    }

    const [y, m] = cohortKey.split("-");
    rows.push({
      cohortMonth: cohortKey,
      label: `T${parseInt(m, 10)}/${y}`,
      size: cohortSize,
      retention,
    });
  }

  return { rows, monthsTracked: months };
}

function parseMonthKey(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
}
