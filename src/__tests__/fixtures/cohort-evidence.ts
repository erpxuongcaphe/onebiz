export function cohortEvidenceFixture(months = 6, branchId: string | null = "branch-fixture", tenantId = "tenant-fixture") {
  return { version: 2, generated_at: "2026-10-27T00:00:00Z", retention_ready: true,
    tenant_id: tenantId, branch_id: branchId, months_tracked: months,
    basis: "completed_external_invoices_by_business_date", first_purchase_scope: branchId === null ? "tenant" : "selected_branch",
    rows: Array.from({ length: months }, (_, index) => {
      const value = new Date(Date.UTC(2026, 10 - months + index, 1));
      return { cohort_month: value.toISOString().slice(0, 7), label: `T${value.getUTCMonth() + 1}/${value.getUTCFullYear()}`,
        size: index === 0 ? 2 : 0,
        retention: Array.from({ length: months - index }, (_, offset) => index === 0 ? offset === 0 ? 100 : offset === 1 ? 50 : 0 : 0),
        closed_observations: Array.from({ length: months - index }, (_, offset) => index + offset < months - 1) };
    }),
    coverage: { external_invoices: 10, identified_invoices: 6, identified_customers: 3, anonymous_invoices: 2, walk_in_invoices: 1,
      unresolved_customer_invoices: 1, excluded_internal_invoices: 2, excluded_order_records: 1, creation_date_fallbacks: 1,
      invalid_date_records: 0, identified_invoice_rate: 60, legacy_trace_gaps: 0, historical_legacy_trace_gaps: 0, confirmed_legacy_sales: 0 },
  };
}
