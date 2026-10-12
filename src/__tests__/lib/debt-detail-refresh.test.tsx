import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
const mocked = vi.hoisted(() => ({ purchases: vi.fn(), invoices: vi.fn(), toast: vi.fn(), available: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: mocked.toast }) }));
vi.mock("@/lib/services/supabase/payments", () => ({ getOpenPurchasesBySupplier: mocked.purchases, getOpenInvoicesByCustomer: mocked.invoices }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("@/components/shared/dialogs/apply-advance-dialog", () => ({
  ApplyAdvanceDialog: (props: { availableAdvance: number; onSuccess: (result: { appliedAmount: number }) => void }) => {
    mocked.available(props.availableAdvance);
    return <button onClick={() => props.onSuccess({ appliedAmount: 2000 })}>Cấn thử cô lập</button>;
  },
}));
import { DebtDetailDialog } from "@/components/shared/dialogs/debt-detail-dialog";
const document = { id: "po-1", code: "NH1", date: "2026-10-01", total: 5000, paid: 0, debt: 5000, ageDays: 1 };
describe("debt detail refresh", () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); mocked.purchases.mockResolvedValue([document]); });
  it("reloads open documents and reduces usable balance after allocating", async () => {
    render(<DebtDetailDialog open onOpenChange={() => {}} mode="supplier" partyId="supplier-1" partyName="Trung Kiên" branchId="branch-1" availableAdvance={10000} />);
    fireEvent.click(await screen.findByRole("button", { name: "Dùng tiền ứng" }));
    expect(mocked.available).toHaveBeenLastCalledWith(10000);
    mocked.purchases.mockResolvedValue([{ ...document, paid: 2000, debt: 3000 }]);
    fireEvent.click(screen.getByRole("button", { name: "Cấn thử cô lập" }));
    await waitFor(() => expect(mocked.purchases).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole("button", { name: "Dùng tiền ứng" }));
    expect(mocked.available).toHaveBeenLastCalledWith(8000);
  });
  it("shows a load failure instead of claiming every document is paid", async () => {
    mocked.purchases.mockRejectedValue(new Error("Không có quyền đọc phiếu"));
    render(<DebtDetailDialog open onOpenChange={() => {}} mode="supplier" partyId="supplier-1" partyName="Trung Kiên" branchId="branch-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không có quyền đọc phiếu");
    expect(screen.queryByText("Đã trả hết nợ cho nhà cung cấp này.")).toBeNull();
  });
});
