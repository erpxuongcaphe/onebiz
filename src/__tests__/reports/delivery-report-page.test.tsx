import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ branch: "branch-a", read: vi.fn(), export: vi.fn(), toast: vi.fn(), range: { from: "2026-11-01", to: "2026-11-01" } }));
vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({ activeBranchId: mocks.branch, branchLabel: mocks.branch, isReady: true }), useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "today", range: mocks.range, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/lib/services/supabase/delivery-invoice-management", () => ({ getDeliveryInvoiceManagement: mocks.read }));
vi.mock("@/lib/utils/excel-export", () => ({ exportReportToExcel: mocks.export, buildReportTitleRows: () => ["Report"] }));
vi.mock("@/app/(main)/phan-tich/_components", () => ({ KpiCard: () => null }));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({ onExportFull, exportDisabled }: { onExportFull: () => void; exportDisabled: boolean }) => <button disabled={exportDisabled} onClick={onExportFull}>Export full</button>,
  ReportDataTable: ({ columns, rows }: { columns: Array<{ label: string }>; rows: Array<{ id: string; staffName: string }> }) => <div>{columns.map(c => <span key={c.label}>{c.label}</span>)}{rows.map(row => <span key={row.id}>{row.staffName}</span>)}</div>,
}));
import Page from "@/app/(main)/phan-tich/fnb-shipper/page";
const row = { id: "order-1", branchId: "branch-a", branchName: "Quán thử", staffId: "staff-1", staffName: "Nhân viên thử", orderNumber: "DH-1", invoiceId: "invoice-1", invoiceCode: "HD-1", invoiceStatus: "completed", orderStatus: "completed", customerName: "Khách thử", paymentMethod: "cash", invoiceTotal: 100, invoicePaid: 60, invoiceDebt: 40, deliveryFee: 10, deliveryStatus: "assigned", deliveryTier: "near", createdAt: "2026-11-01T01:00:00Z", assignedAt: "2026-11-01T01:00:00Z", completedAt: null, durationSeconds: null };
const report = { items: [row], total: 1, canViewMoney: true, dateBasis: "createdAt", paymentBasis: "invoice" };
describe("delivery report filter and export safety", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.branch = "branch-a"; mocks.read.mockResolvedValue(report); mocks.export.mockResolvedValue(undefined); });
  it("exports current branch data with full invoice payment columns", async () => {
    render(<Page />); await screen.findByText("Nhân viên thử"); fireEvent.click(screen.getByText("Export full"));
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    const options = mocks.export.mock.calls[0][0];
    expect(options.sheets).toHaveLength(2); expect(options.branchName).toBe("branch-a");
    expect(options.sheets[1].rows[0]).toMatchObject({ invoicePaid: 60, invoiceDebt: 40, branchName: "Quán thử" });
    expect(options.sheets[1].columns.map((c: { key: string }) => c.key)).toContain("invoicePaid");
    for (const sheet of options.sheets) expect(sheet.titleRows.join(" ")).toContain("Thanh toán hiện tại trên hóa đơn");
  });
  it("does not export money columns when the source denies money permission", async () => {
    mocks.read.mockResolvedValue({ ...report, canViewMoney: false, items: [{ ...row, invoiceTotal: null, invoicePaid: null, invoiceDebt: null, deliveryFee: null, paymentMethod: null }] });
    render(<Page />); await screen.findByText("Nhân viên thử"); fireEvent.click(screen.getByText("Export full"));
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    for (const sheet of mocks.export.mock.calls[0][0].sheets) expect(sheet.columns.some((c: { key: string }) => ["invoiceTotal", "invoicePaid", "invoiceDebt", "deliveryFee"].includes(c.key))).toBe(false);
  });
  it("keeps the same search filter in summary, detail and workbook", async () => {
    render(<Page />); await screen.findByText("Nhân viên thử");
    fireEvent.change(screen.getByLabelText("Tìm đơn, hóa đơn, khách"), { target: { value: "khach thu" } });
    fireEvent.click(screen.getByText("Export full")); await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0].sheets[1].rows).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Tìm đơn, hóa đơn, khách"), { target: { value: "no match" } });
    expect(screen.getByText("Export full")).toBeDisabled();
  });
  it("drops late responses after the branch changes", async () => {
    let resolveOld!: (value: typeof report) => void;
    mocks.read.mockImplementation((branch: string) => branch === "branch-a" ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ ...report, items: [{ ...row, staffName: "Nhân viên mới", branchId: "branch-b" }] }));
    const view = render(<Page />); mocks.branch = "branch-b"; view.rerender(<Page />);
    await screen.findByText("Nhân viên mới"); await act(async () => resolveOld(report));
    expect(screen.queryByText("Nhân viên thử")).not.toBeInTheDocument();
  });
  it("reloads invoice payment without dropping the selected search", async () => {
    render(<Page />); await screen.findByText("Nhân viên thử");
    fireEvent.change(screen.getByLabelText("Tìm đơn, hóa đơn, khách"), { target: { value: "khach thu" } });
    mocks.read.mockResolvedValue({ ...report, items: [{ ...row, invoicePaid: 100, invoiceDebt: 0 }] });
    fireEvent.click(screen.getByRole("button", { name: /Tải lại/ }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    await screen.findByText("Nhân viên thử");
    expect(screen.getByLabelText("Tìm đơn, hóa đơn, khách")).toHaveValue("khach thu");
    fireEvent.click(screen.getByText("Export full")); await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0].sheets[1].rows[0]).toMatchObject({ invoicePaid: 100, invoiceDebt: 0 });
  });
  it("offers an explicit file link without claiming the browser saved it and removes stale links", async () => {
    const create = vi.fn(() => "blob:delivery-test"), revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    mocks.export.mockImplementation(async options => options.onPrepared(new Blob(["fake"]), "delivery-test.xlsx"));
    const view = render(<Page />); await screen.findByText("Nhân viên thử");
    fireEvent.click(screen.getByText("Export full"));
    const link = await screen.findByRole("link", { name: /Tải file Excel/ });
    expect(link).toHaveAttribute("href", "blob:delivery-test");
    expect(link).toHaveAttribute("download", "delivery-test.xlsx");
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Đã tạo file Excel" }));
    fireEvent.change(screen.getByLabelText("Tìm đơn, hóa đơn, khách"), { target: { value: "new scope" } });
    expect(screen.queryByRole("link", { name: /Tải file Excel/ })).not.toBeInTheDocument();
    view.unmount(); expect(revoke).toHaveBeenCalledWith("blob:delivery-test");
    vi.unstubAllGlobals();
  });
});
