import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseCohortEvidence } from "@/lib/reports/cohort-evidence";
import { CustomerCohortCoverage } from "@/components/reports/customer-cohort-coverage";

const scope = { tenantId: "tenant-fixture", branchId: "branch-fixture", months: 2 };
const payload = () => ({ version: 2, generated_at: "2026-10-27T00:00:00Z", retention_ready: true, tenant_id: scope.tenantId, branch_id: scope.branchId,
  months_tracked: 2, basis: "completed_external_invoices_by_business_date", first_purchase_scope: "selected_branch",
  rows: [ { cohort_month: "2026-09", label: "T9", size: 2, retention: [100, 50], closed_observations: [true, false] },
    { cohort_month: "2026-10", label: "T10", size: 0, retention: [0], closed_observations: [false] } ],
  coverage: { external_invoices: 10, identified_invoices: 6, identified_customers: 3, anonymous_invoices: 2, walk_in_invoices: 1,
    unresolved_customer_invoices: 1, excluded_internal_invoices: 2, excluded_order_records: 1, creation_date_fallbacks: 1,
    invalid_date_records: 0, identified_invoice_rate: 60, legacy_trace_gaps: 0, historical_legacy_trace_gaps: 0, confirmed_legacy_sales: 0 },
});
afterEach(cleanup);
describe("build-only cohort evidence", () => {
  it("accepts complete scope-bound evidence", () => expect(parseCohortEvidence(payload(), scope).coverage.identified_invoice_rate).toBe(60));
  it("rejects company branch horizon and first-purchase scope mismatches", () => {
    for (const change of [{ tenant_id: "foreign" }, { branch_id: null }, { months_tracked: 3 }, { first_purchase_scope: "tenant" }])
      expect(() => parseCohortEvidence({ ...payload(), ...change }, scope)).toThrow();
  });
  it("rejects missing fields and dishonest denominator or percentage", () => {
    for (const change of [{ external_invoices: 11 }, { identified_invoice_rate: 61 }, { identified_customers: 7 },
      { identified_invoices: null }, { anonymous_invoices: -1 }, { creation_date_fallbacks: 100 }, { invalid_date_records: NaN }])
      expect(() => parseCohortEvidence({ ...payload(), coverage: { ...payload().coverage, ...change } }, scope)).toThrow();
    const missing = payload(); Reflect.deleteProperty(missing.coverage, "anonymous_invoices");
    expect(() => parseCohortEvidence(missing, scope)).toThrow();
  });
  it("rejects shifted months, missing observations, invented maturity and impossible cohort sizes", () => {
    for (const change of [{ cohort_month: "2026-08" }, { retention: [100] }, { closed_observations: [true, true] }, { size: 4 }, { size: 0 }])
      expect(() => parseCohortEvidence({ ...payload(), rows: [{ ...payload().rows[0], ...change }, payload().rows[1]] }, scope)).toThrow();
  });
  it("renders short coverage labels and native disclosure", () => {
    render(<CustomerCohortCoverage canView data={parseCohortEvidence(payload(), scope)} />);
    expect(screen.getByText("60%")).toBeTruthy(); expect(screen.getByText("6 / 10")).toBeTruthy();
    const summary = screen.getByText(/Chi tiết dữ liệu/);
    expect(summary.closest("details")?.open).toBe(false); fireEvent.click(summary);
    expect(summary.closest("details")?.open).toBe(true);
    expect(screen.getByText("Liên kết khách cần kiểm tra")).toBeTruthy();
  });
  it("hides stale values on errors and denies all coverage when unauthorized", () => {
    const data = parseCohortEvidence(payload(), scope);
    const view = render(<CustomerCohortCoverage canView data={data} error="temporary" />);
    expect(screen.queryByText("60%")).toBeNull(); expect(screen.getByRole("alert")).toBeTruthy();
    view.rerender(<CustomerCohortCoverage canView={false} data={data} />); expect(view.container.textContent).toBe("");
  });
  it("does not turn an empty denominator into zero percent", () => {
    const p = payload(); for (const key of Object.keys(p.coverage)) Reflect.set(p.coverage, key, key === "identified_invoice_rate" ? null : 0);
    p.rows = p.rows.map(row => ({ ...row, size: 0, retention: row.retention.map(() => 0) }));
    render(<CustomerCohortCoverage canView data={parseCohortEvidence(p, scope)} />);
    expect(screen.getByText("Chưa có hóa đơn")).toBeTruthy(); expect(screen.queryByText("0%")).toBeNull();
  });
  it("accepts numeric strings but not blank or unsafe counts", () => {
    const p = payload(); Reflect.set(p.coverage, "identified_invoices", "6");
    expect(parseCohortEvidence(p, scope).coverage.identified_invoices).toBe(6);
    for (const value of ["", " ", Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      Reflect.set(p.coverage, "identified_invoices", value); expect(() => parseCohortEvidence(p, scope)).toThrow();
    }
  });
  it("uses the Vietnam month boundary rather than the UTC month", () => {
    const p = payload(); p.generated_at = "2026-10-31T17:00:00Z";
    expect(() => parseCohortEvidence(p, scope)).toThrow();
    p.rows = [{ cohort_month: "2026-10", label: "T10", size: 2, retention: [100, 0], closed_observations: [true, false] },
      { cohort_month: "2026-11", label: "T11", size: 0, retention: [0], closed_observations: [false] }];
    expect(parseCohortEvidence(p, scope).rows[1].cohort_month).toBe("2026-11");
  });
  it("shows loading without inventing a denominator", () => {
    render(<CustomerCohortCoverage canView />); expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull(); expect(screen.queryByText(/Có mã khách/)).toBeNull();
  });
  it("rejects invalid dates and inconsistent trace counts", () => {
    for (const change of [{ invalid_date_records: 1 }, { legacy_trace_gaps: 1 }, { confirmed_legacy_sales: 11 }])
      expect(() => parseCohortEvidence({ ...payload(), coverage: { ...payload().coverage, ...change } }, scope)).toThrow();
  });
  it("warns about missing historical traces without changing completed-invoice coverage", () => {
    const p = payload(); p.coverage.historical_legacy_trace_gaps = 16;
    render(<CustomerCohortCoverage canView data={parseCohortEvidence(p, scope)} />);
    expect(screen.getByRole("status").textContent).toContain("Đã giữ theo trạng thái");
    expect(screen.getByText("6 / 10")).toBeTruthy();
    expect(screen.getByText("Thiếu nhật ký lịch sử (mọi kỳ)")).toBeTruthy();
  });
  it("never displays complete coverage when a near-complete percentage rounds up", () => {
    const p = payload(); Object.assign(p.coverage, { external_invoices: 10014, identified_invoices: 10009, anonymous_invoices: 2, walk_in_invoices: 1, unresolved_customer_invoices: 2, identified_invoice_rate: 99.9501 });
    render(<CustomerCohortCoverage canView data={parseCohortEvidence(p, scope)} />);
    expect(screen.getByText(">99,9%")).toBeTruthy(); expect(screen.queryByText("100%")).toBeNull();
  });
});
