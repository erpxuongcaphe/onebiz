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

import { getClient, handleError } from "./base";

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
export async function getCustomerCohortReport(options: {
  months?: number;
  branchId?: string;
} = {}): Promise<CohortReportResult> {
  const supabase = getClient();
  const months = Math.min(24, Math.max(1, options.months ?? 6));
  const { data, error } = await (supabase.rpc as any)(
    "get_customer_cohort_report",
    {
      p_months: months,
      p_branch_id: options.branchId ?? null,
    },
  );

  if (error) handleError(error, "getCustomerCohortReport");
  if (!data) throw new Error("Server did not return cohort report data.");

  const raw = data as {
    months_tracked?: number;
    rows?: Array<{
      cohort_month: string;
      label: string;
      size: number | string;
      retention: Array<number | string>;
    }>;
  };

  return {
    monthsTracked: Number(raw.months_tracked ?? months),
    rows: (raw.rows ?? []).map((row) => ({
      cohortMonth: row.cohort_month,
      label: row.label,
      size: Number(row.size ?? 0),
      retention: (row.retention ?? []).map(Number),
    })),
  };
}
