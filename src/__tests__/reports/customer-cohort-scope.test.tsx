import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cohortEvidenceFixture } from "../fixtures/cohort-evidence";

const fake = vi.hoisted(() => ({ branch: "a", actor: "one", allowed: true, exportAllowed: true, fullAllowed: true, ready: true, read: vi.fn(), excel: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({ activeBranchId: fake.branch, branchLabel: fake.branch, branches: [], isReady: fake.ready }) }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ user: { id: fake.actor }, tenant: { id: "tenant" }, isLoading: false, hasPermission: (code: string) => code === "reports.export_detail" ? fake.fullAllowed : code === "reports.export" ? fake.exportAllowed : fake.allowed }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "thisYear", range: { from: "2026-01-01", to: "2026-12-31" }, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/lib/services/supabase/customer-cohort-evidence", () => ({ getCustomerCohortEvidence: fake.read }));
vi.mock("@/lib/utils/excel-export", () => ({ exportReportToExcel: fake.excel }));
vi.mock("@/components/shared/report", () => ({
  ReportTableFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ReportPageHeader: ({ actions, exportDisabled, onExportView, onExportFull }: { actions: ReactNode; exportDisabled: boolean; onExportView?: () => void; onExportFull?: () => void }) => <header>{actions}{onExportView && <button disabled={exportDisabled} onClick={onExportView}>Excel view</button>}{onExportFull && <button disabled={exportDisabled} onClick={onExportFull}>Excel full</button>}</header>,
}));
import CustomerCohortPage from "@/app/(main)/phan-tich/customer-cohort/page";

const result = (branch = fake.branch, months = 6, label = "Cohort A") => {
  const value = cohortEvidenceFixture(months, branch, "tenant");
  value.rows[0].label = label;
  return value;
};
beforeEach(() => {
  fake.branch = "a"; fake.actor = "one"; fake.allowed = true; fake.exportAllowed = true; fake.fullAllowed = true; fake.ready = true;
  fake.read.mockReset().mockImplementation(request => Promise.resolve(result(request.branchId, request.months)));
  fake.excel.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("customer cohort scope integrity", () => {
  it("drops old rows immediately and blocks export when a new branch fails", async () => {
    const view = render(<CustomerCohortPage />); await screen.findByText("Cohort A");
    fake.branch = "b"; fake.read.mockRejectedValueOnce(new Error("Source unavailable")); view.rerender(<CustomerCohortPage />);
    expect(screen.queryByText("Cohort A")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excel full" })).toBeDisabled();
    await screen.findByRole("alert"); expect(screen.queryByText("Cohort A")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excel full" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại" })); await screen.findByText("Cohort A");
    expect(fake.read).toHaveBeenLastCalledWith({ actorId: "one", tenantId: "tenant", branchId: "b", months: 6 });
  });
  it("ignores a late result from the old branch", async () => {
    let resolve!: (value: ReturnType<typeof result>) => void;
    fake.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const view = render(<CustomerCohortPage />); fake.branch = "b"; view.rerender(<CustomerCohortPage />);
    await screen.findByText("Cohort A"); await act(async () => resolve(result("a", 6, "Late old")));
    expect(screen.queryByText("Late old")).not.toBeInTheDocument();
  });
  it("refetches on account change even at the same branch", async () => {
    const view = render(<CustomerCohortPage />); await screen.findByText("Cohort A");
    fake.actor = "two"; fake.read.mockResolvedValueOnce(result("a", 6, "Account two")); view.rerender(<CustomerCohortPage />);
    expect(screen.queryByText("Cohort A")).not.toBeInTheDocument(); await screen.findByText("Account two");
    expect(fake.read).toHaveBeenLastCalledWith(expect.objectContaining({ actorId: "two" }));
  });
  it("does not read without permission or keep results when readiness is lost", async () => {
    fake.allowed = false; const view = render(<CustomerCohortPage />); expect(fake.read).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("Không có quyền");
    fake.allowed = true; view.rerender(<CustomerCohortPage />); await screen.findByText("Cohort A");
    fake.ready = false; view.rerender(<CustomerCohortPage />); expect(screen.queryByText("Cohort A")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Excel full" })).toBeDisabled();
  });
  it("keeps month selection and Excel metadata bound to the returned scope", async () => {
    const view = render(<CustomerCohortPage />); await screen.findByText("Cohort A");
    fireEvent.change(screen.getByRole("combobox", { name: "Số tháng theo dõi" }), { target: { value: "12" } });
    await screen.findByText("Cohort A"); expect(fake.read).toHaveBeenLastCalledWith({ actorId: "one", tenantId: "tenant", branchId: "a", months: 12 });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Excel full" })));
    expect(fake.excel).toHaveBeenCalledWith(expect.objectContaining({ mode: "full", branchName: "a", range: { from: "2025-11-01", to: "2026-10-31" } }));
    const options = fake.excel.mock.calls[0][0];
    expect(options.sheets).toHaveLength(3); expect(options.shouldSave()).toBe(true);
    fake.branch = "b"; view.rerender(<CustomerCohortPage />); expect(options.shouldSave()).toBe(false);
    await screen.findByText("Cohort A"); expect(screen.getByRole("combobox", { name: "Số tháng theo dõi" })).toHaveValue("12");
  });
  it("separates view export from full export permission", async () => {
    fake.fullAllowed = false;
    const view = render(<CustomerCohortPage />); await screen.findByText("Cohort A");
    expect(screen.queryByRole("button", { name: "Excel full" })).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Excel view" })));
    const options = fake.excel.mock.calls[0][0];
    expect(options.mode).toBe("view"); expect(options.sheets).toHaveLength(1);
    expect(options.sheets[0].tablePreferenceKey).toBe("report.customer-cohort.matrix");
    fake.exportAllowed = false; view.rerender(<CustomerCohortPage />);
    expect(options.shouldSave()).toBe(false);
    expect(screen.queryByRole("button", { name: /Excel/ })).not.toBeInTheDocument();
    await screen.findByText("Cohort A");
  });
  it("keeps empty cohorts blank in Excel rather than artificial zero retention", async () => {
    const empty = result(); empty.rows.forEach(row => { row.size = 0; row.retention.fill(0); });
    fake.read.mockResolvedValue(empty);
    render(<CustomerCohortPage />); await screen.findByText("Cohort A");
    expect(screen.getAllByText("Chưa đủ dữ liệu").length).toBeGreaterThan(0);
    expect(screen.queryByText("Cần cải thiện")).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Excel full" })));
    expect(fake.excel.mock.calls[0][0].sheets[1].rows[0]).toMatchObject({ size: 0, m0: null, m1: null });
  });
  it("rejects a successful response for a different tenant", async () => {
    fake.read.mockResolvedValue(cohortEvidenceFixture(6, "a", "other"));
    render(<CustomerCohortPage />); await screen.findByRole("alert");
    expect(screen.queryByText("Cohort A")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excel full" })).toBeDisabled();
  });
});
