import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ branch: "a", actor: "one", allowed: true, exportAllowed: true, ready: true, read: vi.fn(), excel: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({ activeBranchId: fake.branch, branchLabel: fake.branch, branches: [], isReady: fake.ready }) }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ user: { id: fake.actor }, tenant: { id: "tenant" }, hasPermission: (code: string) => code.startsWith("reports.export") ? fake.exportAllowed : fake.allowed }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "thisYear", range: { from: "2026-01-01", to: "2026-12-31" }, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/lib/services/supabase/customer-cohort", () => ({ getCustomerCohortReport: fake.read }));
vi.mock("@/lib/utils/excel-export", () => ({ exportReportToExcel: fake.excel, buildReportTitleRows: vi.fn(() => []), buildMetricSummarySheet: vi.fn(() => ({})) }));
vi.mock("@/components/shared/report", () => ({
  ReportTableFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ReportPageHeader: ({ actions, exportDisabled, onExportView, onExportFull }: { actions: ReactNode; exportDisabled: boolean; onExportView?: () => void; onExportFull?: () => void }) => <header>{actions}{onExportView && <button disabled={exportDisabled} onClick={onExportView}>Excel view</button>}{onExportFull && <button disabled={exportDisabled} onClick={onExportFull}>Excel full</button>}</header>,
}));
vi.mock("@/app/(main)/phan-tich/_components", () => ({ KpiCard: ({ label, value }: { label: string; value: string }) => <div>{label}: {value}</div> }));
import CustomerCohortPage from "@/app/(main)/phan-tich/customer-cohort/page";

const result = (label = "Cohort A") => ({ monthsTracked: 6, rows: [{ cohortMonth: "2026-10", label, size: 8, retention: [100, 25] }] });
beforeEach(() => { fake.branch = "a"; fake.actor = "one"; fake.allowed = true; fake.exportAllowed = true; fake.ready = true; fake.read.mockReset().mockResolvedValue(result()); fake.excel.mockReset(); });
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
    expect(fake.read).toHaveBeenLastCalledWith({ branchId: "b", months: 6 });
  });
  it("ignores a late result from the old branch", async () => {
    let resolve!: (value: ReturnType<typeof result>) => void;
    fake.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const view = render(<CustomerCohortPage />); fake.branch = "b"; view.rerender(<CustomerCohortPage />);
    await screen.findByText("Cohort A"); await act(async () => resolve(result("Late old")));
    expect(screen.queryByText("Late old")).not.toBeInTheDocument();
  });
  it("refetches on account change even at the same branch", async () => {
    const view = render(<CustomerCohortPage />); await screen.findByText("Cohort A");
    fake.actor = "two"; fake.read.mockResolvedValueOnce(result("Account two")); view.rerender(<CustomerCohortPage />);
    expect(screen.queryByText("Cohort A")).not.toBeInTheDocument(); await screen.findByText("Account two"); expect(fake.read).toHaveBeenCalledTimes(2);
  });
  it("does not read without permission or keep results when readiness is lost", async () => {
    fake.allowed = false; const view = render(<CustomerCohortPage />); expect(fake.read).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("Không có quyền");
    fake.allowed = true; view.rerender(<CustomerCohortPage />); await screen.findByText("Cohort A");
    fake.ready = false; view.rerender(<CustomerCohortPage />); expect(screen.queryByText("Cohort A")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Excel full" })).toBeDisabled();
  });
  it("keeps month selection and Excel metadata bound to the returned cohort scope", async () => {
    const view = render(<CustomerCohortPage />); await screen.findByText("Cohort A");
    fake.read.mockResolvedValueOnce(result("Twelve")); fireEvent.change(screen.getByRole("combobox", { name: "Số tháng theo dõi" }), { target: { value: "12" } });
    await screen.findByText("Twelve"); expect(fake.read).toHaveBeenLastCalledWith({ branchId: "a", months: 12 });
    fireEvent.click(screen.getByRole("button", { name: "Excel full" })); expect(fake.excel).toHaveBeenCalledWith(expect.objectContaining({ branchName: "a", range: { from: "2026-10-01", to: "2026-10-31" } }));
    const exportOptions = fake.excel.mock.calls[0][0];
    expect(exportOptions.shouldSave()).toBe(true);
    fake.branch = "b"; view.rerender(<CustomerCohortPage />);
    expect(exportOptions.shouldSave()).toBe(false);
  });
  it("hides both Excel actions when export rights are absent", async () => {
    fake.exportAllowed = false; render(<CustomerCohortPage />); await screen.findByText("Cohort A"); expect(screen.queryByRole("button", { name: /Excel/ })).not.toBeInTheDocument();
  });
});
