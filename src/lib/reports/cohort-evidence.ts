import { z } from "zod";
import { cashDateTimeInput } from "@/lib/cash-time";

const numeric = z.preprocess(value => typeof value === "string" && value.trim() ? Number(value) : value, z.number().finite());
const count = numeric.pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER));
const schema = z.object({
  version: z.literal(2), generated_at: z.string().datetime({ offset: true }), retention_ready: z.boolean(),
  tenant_id: z.string().min(1), branch_id: z.string().min(1).nullable(),
  months_tracked: count.pipe(z.number().min(1).max(24)),
  basis: z.literal("completed_external_invoices_by_business_date"),
  first_purchase_scope: z.enum(["tenant", "selected_branch"]),
  rows: z.array(z.object({
    cohort_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), label: z.string().min(1), size: count,
    retention: z.array(numeric.pipe(z.number().min(0).max(100))), closed_observations: z.array(z.boolean()),
  })),
  coverage: z.object({
    external_invoices: count, identified_invoices: count, identified_customers: count,
    anonymous_invoices: count, walk_in_invoices: count, unresolved_customer_invoices: count,
    excluded_internal_invoices: count, excluded_order_records: count,
    legacy_trace_gaps: count, historical_legacy_trace_gaps: count, confirmed_legacy_sales: count,
    creation_date_fallbacks: count, invalid_date_records: count,
    identified_invoice_rate: numeric.pipe(z.number().min(0).max(100)).nullable(),
  }),
});

export type CohortEvidence = z.infer<typeof schema>;

export function summarizeCohortEvidence(data: CohortEvidence) {
  if (!data.retention_ready) return { firstTimeCustomers: null, m1Retention: null, matureGroups: 0 };
  const mature = data.rows.filter(row => row.size > 0 && row.closed_observations[1] === true);
  return {
    firstTimeCustomers: data.rows.reduce((sum, row) => sum + row.size, 0),
    m1Retention: mature.length ? Math.round(mature.reduce((sum, row) => sum + row.retention[1], 0) / mature.length) : null,
    matureGroups: mature.length,
  };
}

/** Reject incomplete responses and data returned for a different report scope. */
export function parseCohortEvidence(input: unknown, scope: { tenantId: string; branchId: string | null; months: number }): CohortEvidence {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error("Nguồn khách quay lại chưa đầy đủ.");
  const data = result.data;
  const c = data.coverage;
  const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
  const current = monthIndex(cashDateTimeInput(new Date(data.generated_at)).slice(0, 7));
  const expectedRate = c.external_invoices === 0 ? null : Math.round(c.identified_invoices * 1000000 / c.external_invoices) / 10000;
  if (data.tenant_id !== scope.tenantId || data.branch_id !== scope.branchId || data.months_tracked !== scope.months ||
    data.first_purchase_scope !== (scope.branchId === null ? "tenant" : "selected_branch") ||
    c.external_invoices !== c.identified_invoices + c.anonymous_invoices + c.walk_in_invoices + c.unresolved_customer_invoices ||
    c.identified_customers > c.identified_invoices || c.identified_invoice_rate !== expectedRate ||
    c.creation_date_fallbacks > c.external_invoices + c.excluded_internal_invoices + c.excluded_order_records ||
    c.legacy_trace_gaps > c.historical_legacy_trace_gaps || c.confirmed_legacy_sales + c.legacy_trace_gaps > c.external_invoices ||
    (data.retention_ready && c.invalid_date_records > 0) ||
    data.rows.length !== scope.months || data.rows.reduce((sum, row) => sum + row.size, 0) > c.identified_customers ||
    data.rows.some((row, index) => {
      const first = monthIndex(row.cohort_month);
      return first !== current - scope.months + index + 1 || row.retention.length !== scope.months - index ||
        row.closed_observations.length !== row.retention.length ||
        row.closed_observations.some((closed, offset) => closed !== (first + offset < current)) ||
        (row.size === 0 ? row.retention.some(value => value !== 0) : row.retention[0] !== 100);
    })) throw new Error("Số liệu khách quay lại không khớp phạm vi hoặc kỳ báo cáo.");
  return data;
}
