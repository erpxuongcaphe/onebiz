import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PartyCashHistory } from "@/components/shared/party-cash-history";
const actions = vi.hoisted(() => ({ cancel: vi.fn(), export: vi.fn(), all: vi.fn(), canCancel: true, category: "supplier_payment" }));

vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({ activeBranchId: "branch-1", branchLabel: "Kho Tong", branches:[{id:'branch-1',name:'Kho Tong'}],isReady: true }) }));
vi.mock("@/lib/permissions/use-permission", () => ({ usePermissions: () => ({ hasPermission: (code: string) => code !== "finance.void_transaction" || actions.canCancel, isLoading: false }) }));
vi.mock("@/lib/utils/export", () => ({ exportToExcel: actions.export }));
vi.mock("@/lib/services/supabase/cash-book", () => ({ getCashAmendmentHistory: async () => [], cancelCashTransaction: actions.cancel, getAllPartyCashHistory: actions.all, getPartyCashHistory: async () => ({ total: 1, data: [{
  id: "cash-1", code: "PC000334", date: "2026-10-12", type: "payment", category: actions.category,
  amount: 630000, branchName: "Kho Tong", status: "completed", paymentMethod: "cash",
  occurredAt: "2026-10-12T07:12:00Z", createdAt: "2026-10-12T07:12:08Z", createdByName: "admin",
}] }) }));
vi.mock("@/lib/services/supabase/debt-workspace", () => ({ getCounterpartyBalanceSummary: async () => ({ customers: [], suppliers: [{ partyId: "supplier-1", debt: 0, advance: 4457009 }] }) }));
vi.mock("@/components/shared/dialogs/debt-detail-dialog", () => ({ DebtDetailDialog: () => null }));
vi.mock("@/components/shared/dialogs/settle-debt-dialog", () => ({ SettleDebtDialog: () => null }));

describe("party cash history presentation", () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); actions.canCancel = true; actions.category = "supplier_payment"; actions.cancel.mockResolvedValue(undefined); actions.export.mockResolvedValue(undefined); actions.all.mockResolvedValue([{ id: "cash-1", code: "PC000334", date: "2026-10-12", type: "payment", category: "supplier_payment", amount: 630000, status: "completed" }]); });
  it("separates booking day from actual payment time and labels payment categories", async () => {
    render(<PartyCashHistory mode="supplier" partyId="supplier-1" partyName="Trung Kien" />);
    expect(await screen.findByText("Chi trả NCC")).toBeInTheDocument();
    expect(screen.getByText("12/10/2026")).toBeInTheDocument();
    expect(screen.queryByText("12/10/2026 07:00")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Xem phiếu PC000334" }));
    expect(await screen.findByRole("heading", { name: "Phiếu chi PC000334" })).toBeInTheDocument();
    expect(screen.getAllByText("Tiền mặt").length).toBeGreaterThan(0);
    expect(screen.getByText(/14:12:00/)).toBeInTheDocument();
  });
  it("exports all filtered rows with numeric amounts rather than the displayed page", async () => {
    render(<PartyCashHistory mode="supplier" partyId="supplier-1" partyName="Trung Kien" />);
    await screen.findByText("Chi trả NCC");
    fireEvent.click(screen.getByRole("button", { name: "Xuất Excel" }));
    await waitFor(() => expect(actions.export).toHaveBeenCalled());
    expect(actions.all).toHaveBeenCalledWith("supplier", "supplier-1", "branch-1", {});
    expect(actions.export.mock.calls[0][0][0]).toMatchObject({ amount: 630000, bookingDate: "12/10/2026", partyName: "Trung Kien" });
  });
  it("requires a reason and cancels through the existing atomic service", async () => {
    render(<PartyCashHistory mode="supplier" partyId="supplier-1" partyName="Trung Kien" />);
    fireEvent.click(await screen.findByRole("button", { name: "Xem phiếu PC000334" }));
    fireEvent.click(screen.getByRole("button", { name: /^Hủy phiếu$/ }));
    expect(screen.getByRole("button", { name: /^Hủy phiếu$/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Lý do hủy"), { target: { value: "Nhập sai số tiền" } });
    fireEvent.click(screen.getByRole("button", { name: /^Hủy phiếu$/ }));
    await waitFor(() => expect(actions.cancel).toHaveBeenCalledWith("cash-1", "Nhập sai số tiền"));
  });
  it("does not expose cancellation without permission", async () => {
    actions.canCancel = false;
    render(<PartyCashHistory mode="supplier" partyId="supplier-1" partyName="Trung Kien" />);
    fireEvent.click(await screen.findByRole("button", { name: "Xem phiếu PC000334" }));
    expect(screen.queryByRole("button", { name: /^Hủy phiếu$/ })).toBeNull();
  });
  it("does not route advance vouchers through generic payment cancellation", async () => {
    actions.category = "supplier_advance";
    render(<PartyCashHistory mode="supplier" partyId="supplier-1" partyName="Trung Kien" />);
    fireEvent.click(await screen.findByRole("button", { name: "Xem phiếu PC000334" }));
    expect(screen.queryByRole("button", { name: /^Hủy phiếu$/ })).toBeNull();
  });
  it("contains the wide table without expanding the surrounding dialog", async () => {
    const { container } = render(<PartyCashHistory mode="supplier" partyId="supplier-1" partyName="Trung Kien" />);
    await screen.findByText("Chi trả NCC");
    expect(container.firstElementChild).toHaveClass("min-w-0", "w-full");
    expect(screen.getByRole("table").parentElement).toHaveClass("min-w-0", "w-full", "overflow-auto");
  });
});
