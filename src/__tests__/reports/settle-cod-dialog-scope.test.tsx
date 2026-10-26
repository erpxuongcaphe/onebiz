import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const fake = vi.hoisted(() => ({ read: vi.fn(), settle: vi.fn(), toast: vi.fn(), permission: true, user: "user-a" }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: fake.toast }) }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ user: { id: fake.user }, tenant: { id: "tenant" }, hasPermission: () => fake.permission }) }));
vi.mock("@/lib/services/supabase/shipping", () => ({ getUnsettledShipments: fake.read, settleCod: fake.settle }));
vi.mock("@/lib/services/supabase/cod-reconciliation", () => ({ settleCodScoped: fake.settle }));
vi.mock("@/lib/services/supabase/money-accounts", () => ({
  getMoneyAccountOptions: async (branch: string) => [{ id: "account-a", branch_id: branch, code: "NH01", name: "Ngân hàng", kind: "bank", active: true }],
  accountSupportsMethod: (_account: unknown, method: string) => method === "transfer",
}));
vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div role="dialog">{children}</div> : null, DialogContent: Box, DialogHeader: Box, DialogTitle: Box, DialogDescription: Box, DialogFooter: Box };
});
import { SettleCodDialog } from "@/components/shared/dialogs/settle-cod-dialog";
const row = (code: string) => ({ id: code, code, invoiceCode: `HD-${code}`, customerName: "Fixture", codAmount: 100, deliveredAt: "2026-10-01T00:00:00Z" });
const props = { open: true, onOpenChange: vi.fn(), partnerId: "partner", partnerName: "Fixture", branchId: "branch-a" };
beforeEach(() => { fake.permission = true; fake.user = "user-a"; fake.read.mockReset().mockResolvedValue([row("VD-a"), row("VD-b")]); fake.settle.mockReset().mockResolvedValue({ code: "DS-fixture", totalCod: 100, totalPartnerFee: 0, netAmount: 100, receipts: 1 }); fake.toast.mockReset(); props.onOpenChange.mockClear(); });
afterEach(cleanup);
describe("COD explicit selection and scope", () => {
  it("requires explicit selection and submits only selected shipments once", async () => {
    render(<SettleCodDialog {...props} />);
    const checkbox = await screen.findByRole("checkbox", { name: "Chọn vận đơn VD-a" });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Xác nhận đối soát" })).toBeDisabled();
    expect(screen.getByText("Cập nhật")).toBeInTheDocument();
    expect(screen.queryByText("Ngày giao")).not.toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(screen.getByRole("button", { name: "Xác nhận đối soát (1 đơn)" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Tài khoản đối soát"), { target: { value: "account-a" } });
    const confirm = screen.getByRole("button", { name: "Xác nhận đối soát (1 đơn)" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    await waitFor(() => expect(fake.settle).toHaveBeenCalledTimes(1));
    expect(fake.settle).toHaveBeenCalledWith({ requestId: expect.any(String), branchId: "branch-a", moneyAccountId: "account-a", partnerId: "partner", items: [{ shipmentId: "VD-a", partnerFee: 0 }], paymentMethod: "transfer", note: null });
  });
  it("drops late responses from the previous branch", async () => {
    let resolve!: (rows: ReturnType<typeof row>[]) => void;
    fake.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const view = render(<SettleCodDialog {...props} />);
    view.rerender(<SettleCodDialog {...props} branchId="branch-b" />);
    await screen.findByRole("checkbox", { name: "Chọn vận đơn VD-a" });
    await act(async () => { resolve([row("Old")]); });
    expect(screen.queryByRole("checkbox", { name: "Chọn vận đơn Old" })).not.toBeInTheDocument();
    expect(fake.settle).not.toHaveBeenCalled();
  });
  it("clears selection immediately when account changes", async () => {
    const view = render(<SettleCodDialog {...props} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Chọn vận đơn VD-a" }));
    fake.read.mockReturnValue(new Promise(() => {})); fake.user = "user-b";
    view.rerender(<SettleCodDialog {...props} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xác nhận đối soát" })).toBeDisabled();
  });
  it("does not read or submit without the existing transaction permission", async () => {
    fake.permission = false; render(<SettleCodDialog {...props} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Không có quyền");
    expect(fake.read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đối soát" }));
    expect(fake.settle).not.toHaveBeenCalled();
  });
  it("keeps failed reads unselectable", async () => {
    fake.read.mockRejectedValue(new Error("Read unavailable")); render(<SettleCodDialog {...props} />);
    await screen.findByText("Read unavailable");
    expect(screen.getByRole("button", { name: "Xác nhận đối soát" })).toBeDisabled();
    expect(fake.settle).not.toHaveBeenCalled();
  });
});
