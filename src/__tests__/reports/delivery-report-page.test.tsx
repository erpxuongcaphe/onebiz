import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  branch: "branch-a", summary: vi.fn(), detail: vi.fn(), export: vi.fn(), toast: vi.fn(),
  range: { from: "2026-11-01", to: "2026-11-01" },
}));
vi.mock("@/lib/contexts", () => ({
  useBranchFilter: () => ({ activeBranchId: mocks.branch, branchLabel: mocks.branch, isReady: true }),
  useAuth: () => ({}), useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "today", range: mocks.range, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/lib/services", () => ({ getDeliveryStaffPerformance: mocks.summary, getOrdersByDeliveryStaff: mocks.detail }));
vi.mock("@/lib/utils/excel-export", () => ({ exportReportToExcel: mocks.export, buildReportTitleRows: () => ["Report"] }));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({ onExportFull, exportDisabled }: { onExportFull: () => void; exportDisabled: boolean }) => <button disabled={exportDisabled} onClick={onExportFull}>Export full</button>,
  ReportTableFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/app/(main)/phan-tich/_components", () => ({
  KpiCard: () => null,
  ChartCard: ({ title, children }: { title: string; children: ReactNode }) => <section><h2>{title}</h2>{children}</section>,
}));
import Page from "@/app/(main)/phan-tich/fnb-shipper/page";

const staff = { staffId: "staff-1", staffName: "Nhân viên thử", totalOrders: 1, totalRevenue: 100, totalDeliveryFee: 10, avgDeliverySeconds: 0, completedCount: 0 };
const order = { kitchenOrderId: "order-1", orderNumber: "DH-test", invoiceId: "inv-1", invoiceCode: "HD-test", customerName: "Khách thử", total: 100, deliveryFee: 10, deliveryTier: "near", createdAt: "2026-11-01T01:00:00Z", assignedAt: null, completedAt: null, durationSeconds: null };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

describe("delivery report filter and export safety", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.branch = "branch-a";
    mocks.summary.mockResolvedValue([staff]); mocks.detail.mockResolvedValue([order]); mocks.export.mockResolvedValue(undefined);
  });
  it("clears selected detail when branch changes even if the same employee remains", async () => {
    const view = render(<Page />);
    fireEvent.click(await screen.findByText(staff.staffName));
    await screen.findByText("DH-test");
    mocks.branch = "branch-b"; view.rerender(<Page />);
    await waitFor(() => expect(mocks.summary).toHaveBeenLastCalledWith("branch-b", mocks.range));
    expect(screen.queryByText("DH-test")).not.toBeInTheDocument();
  });
  it("discards a full export if its branch changes while details are loading", async () => {
    const pending = deferred<typeof order[]>(); mocks.detail.mockReturnValue(pending.promise);
    const view = render(<Page />); await screen.findByText(staff.staffName);
    fireEvent.click(screen.getByText("Export full"));
    mocks.branch = "branch-b"; view.rerender(<Page />);
    await waitFor(() => expect(mocks.summary).toHaveBeenLastCalledWith("branch-b", mocks.range));
    await act(async () => pending.resolve([order]));
    expect(mocks.export).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Bộ lọc đã thay đổi" }));
  });
  it("exports both sheets with matching totals, full detail and selected scope", async () => {
    render(<Page />); await screen.findByText(staff.staffName);
    fireEvent.click(screen.getByText("Export full"));
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    const options = mocks.export.mock.calls[0][0];
    expect(options.branchName).toBe("branch-a"); expect(options.range).toEqual(mocks.range);
    expect(options.sheets).toHaveLength(2);
    expect(options.sheets[0].footer).toMatchObject({ totalOrders: 1, totalRevenue: 100, totalDeliveryFee: 10 });
    expect(options.sheets[1].rows[0]).toMatchObject({ orderNumber: "DH-test", status: "Chưa ghi nhận nhận giao", duration: "" });
    expect(options.sheets[1].columns).toHaveLength(12);
  });
});
