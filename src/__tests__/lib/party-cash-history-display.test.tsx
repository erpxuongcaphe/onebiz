import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PartyCashHistory } from "@/components/shared/party-cash-history";

vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({ activeBranchId: "branch-1", branchLabel: "Kho Tong", isReady: true }) }));
vi.mock("@/lib/permissions/use-permission", () => ({ usePermissions: () => ({ hasPermission: () => true, isLoading: false }) }));
vi.mock("@/lib/services/supabase/cash-book", () => ({ getPartyCashHistory: async () => ({ total: 1, data: [{
  id: "cash-1", code: "PC000334", date: "2026-10-12", type: "payment", category: "supplier_payment",
  amount: 630000, branchName: "Kho Tong", status: "completed", paymentMethod: "cash",
  occurredAt: "2026-10-12T07:12:00Z", createdAt: "2026-10-12T07:12:08Z", createdByName: "admin",
}] }) }));
vi.mock("@/lib/services/supabase/debt-workspace", () => ({ getCounterpartyBalanceSummary: async () => ({ customers: [], suppliers: [{ partyId: "supplier-1", debt: 0, advance: 4457009 }] }) }));
vi.mock("@/components/shared/dialogs/debt-detail-dialog", () => ({ DebtDetailDialog: () => null }));

describe("party cash history presentation", () => {
  it("separates booking day from actual payment time and labels payment categories", async () => {
    render(<PartyCashHistory mode="supplier" partyId="supplier-1" partyName="Trung Kien" />);
    expect(await screen.findByText("Chi trả NCC")).toBeInTheDocument();
    expect(screen.getByText("12/10/2026")).toBeInTheDocument();
    expect(screen.queryByText("12/10/2026 07:00")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Xem phiếu PC000334" }));
    expect(await screen.findByRole("heading", { name: "Phiếu chi PC000334" })).toBeInTheDocument();
    expect(screen.getByText("Tiền mặt")).toBeInTheDocument();
    expect(screen.getByText(/14:12:00/)).toBeInTheDocument();
  });
});
