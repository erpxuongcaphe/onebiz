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
 * Empty or immature cohorts are not evidence of low retention.
 */

import { getClient, handleError } from "./base";
import { z } from "zod";

const numeric = z.preprocess(value => typeof value === "string" && value.trim() ? Number(value) : value, z.number().finite());
const cohortSchema = z.object({
  generated_at: z.string().datetime({ offset: true }),
  months_tracked: numeric.pipe(z.number().int().min(1).max(24)),
  rows: z.array(z.object({
    cohort_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    label: z.string().min(1), size: numeric.pipe(z.number().int().nonnegative()),
    retention: z.array(numeric.pipe(z.number().min(0).max(100))),
  })),
});

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
  generatedAt: string;
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
  const requested = options.months ?? 6;
  if (!Number.isSafeInteger(requested)) throw new Error("Số tháng theo dõi chưa hợp lệ.");
  const months = Math.min(24, Math.max(1, requested));
  const { data, error } = await supabase.rpc(
    "get_customer_cohort_report" as never,
    {
      p_months: months,
      p_branch_id: options.branchId ?? null,
    } as never,
  );

  if (error) handleError(error, "getCustomerCohortReport");
  const parsed = cohortSchema.safeParse(data);
  if (!parsed.success) throw new Error("Nguồn khách quay lại chưa đầy đủ. Vui lòng tải lại.");
  const raw = parsed.data;
  const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
  if (raw.months_tracked !== months || raw.rows.length !== months || raw.rows.some((row, index) =>
    row.retention.length !== months - index ||
    (index > 0 && monthIndex(row.cohort_month) !== monthIndex(raw.rows[index - 1].cohort_month) + 1) ||
    (row.size > 0 ? row.retention[0] !== 100 : row.retention.some(value => value !== 0)))) {
    throw new Error("Nhóm khách và kỳ theo dõi không khớp. Vui lòng tải lại.");
  }

  return {
    generatedAt: raw.generated_at,
    monthsTracked: raw.months_tracked,
    rows: raw.rows.map((row) => ({
      cohortMonth: row.cohort_month,
      label: row.label,
      size: row.size,
      retention: row.retention,
    })),
  };
}
