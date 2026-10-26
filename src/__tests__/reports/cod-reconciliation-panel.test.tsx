import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ allowed: true, read: vi.fn(), trace: vi.fn(), full: vi.fn() }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ user: { id: "actor" }, tenant: { id: "tenant" }, hasPermission: () => fake.allowed }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ isReady: true, preset: "today", range: { from: "2026-10-26", to: "2026-10-26" }, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/components/shared/report/report-date-range-picker", () => ({ ReportDateRangePicker: () => <span>Hôm nay</span> }));
vi.mock("@/lib/services/supabase/cod-reconciliation", () => ({ getCodReconciliation: fake.read, getCodSettlementTrace: fake.trace, getAllCodReconciliation: fake.full, COD_RECONCILIATION_LABELS: { unlinked: "Thiếu liên kết" } }));
import { CodReconciliationPanel } from "@/components/shared/cod-reconciliation-panel";
const result = (code = "DS-fixture") => ({ items: [{ id: "one", code, branchName: "Fixture", partnerName: "Fixture", createdAt: "2026-10-26T01:00:00Z", paymentMethod: "transfer", shipmentCount: 1, linkedCount: 0, expectedReceipts: 100, expectedFees: 10, expectedNet: 90, postedReceipts: null, postedFees: 10, postedNet: null, receiptDifference: null, feeDifference: 0, status: "unlinked" }], total: 1,
  summary: { count: 1, matchedCount: 0, reviewCount: 1, postedReceipts: null, postedFees: 10, postedNet: null } });
beforeEach(() => { fake.allowed = true; fake.read.mockReset().mockResolvedValue(result()); fake.trace.mockReset(); fake.full.mockReset(); });
afterEach(cleanup);
describe("COD readonly reconciliation UI", () => {
  it("does not read financial history without cash-book permission", () => {
    fake.allowed = false;
    render(<CodReconciliationPanel branchId="a" branchName="Fixture" branchReady />);
    expect(fake.read).not.toHaveBeenCalled();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
  it("shows full indicators and unknown legacy amounts rather than zero", async () => {
    render(<CodReconciliationPanel branchId="a" branchName="Fixture" branchReady />);
    await screen.findAllByText("DS-fixture");
    expect(screen.getByRole("columnheader", { name: "Chênh lệch phí" })).toBeInTheDocument();
    expect(screen.getAllByText("Chưa xác minh").length).toBeGreaterThan(1);
    expect(screen.getByRole("combobox", { name: "Sắp xếp đối soát" }).querySelectorAll("option")).toHaveLength(16);
  });
  it("clears old branch rows immediately and discards late responses", async () => {
    let resolve!: (value: ReturnType<typeof result>) => void;
    fake.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const view = render(<CodReconciliationPanel branchId="a" branchName="A" branchReady />);
    view.rerender(<CodReconciliationPanel branchId="b" branchName="B" branchReady />);
    await screen.findAllByText("DS-fixture");
    await act(async () => resolve(result("DS-old")));
    expect(screen.queryByText("DS-old")).not.toBeInTheDocument();
  });
  it("does not retain the previous totals when filtering fails", async () => {
    render(<CodReconciliationPanel branchId="a" branchName="Fixture" branchReady />);
    await screen.findAllByText("DS-fixture");
    fake.read.mockRejectedValue(new Error("Source unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Tải lại đối soát" }));
    expect(screen.queryByText("DS-fixture")).not.toBeInTheDocument();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Excel đầy đủ" })).toBeDisabled();
  });
});
