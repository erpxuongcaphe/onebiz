import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CompleteProductionOrderDialog } from "@/components/shared/dialogs/complete-production-order-dialog";
import type { ProductionOrder } from "@/lib/types";

const mocks = vi.hoisted(() => ({ check: vi.fn(), detail: vi.fn(), complete: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: mocks.toast }), useAuth: () => ({ user: null }) }));
vi.mock("@/lib/services", () => ({
  checkMaterialsAvailability: mocks.check, completeProductionAtomic: mocks.complete,
  getProductionOrderById: mocks.detail,
  getBranches: async () => [], createInternalSale: vi.fn(), syncInternalEntities: vi.fn(),
}));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: vi.fn(), getCurrentContext: vi.fn() }));
vi.mock("@/components/ui/icon", () => ({ Icon: () => <span /> }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children, onOpenChange }: { open: boolean; children: React.ReactNode; onOpenChange: (v: boolean) => void }) => open ? <><button onClick={() => onOpenChange(false)}>Dismiss</button>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const order = (id: string, materials = true) => ({
  id, code: id, branchId: "xtb", plannedQty: 10, productName: "Thạch",
  materials: materials ? [{ productId: id, productName: id, plannedQty: 1, unit: "G" }] : [],
} as ProductionOrder);
const checks = (id: string) => [{ productId: id, productName: id, needed: 1, available: 2, unit: "G", sufficient: true }];
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => { vi.clearAllMocks(); mocks.check.mockResolvedValue(checks("A")); mocks.detail.mockResolvedValue(order("A")); mocks.complete.mockResolvedValue({}); });
afterEach(cleanup);

describe("production completion UX", () => {
  it("loads missing materials from the persisted order before enabling completion", async () => {
    const pending = deferred<ProductionOrder>();
    mocks.detail.mockReturnValue(pending.promise);
    const summary = { ...order("A"), materials: undefined };
    render(<CompleteProductionOrderDialog open order={summary} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Hoàn thành" })).toBeDisabled();
    expect(mocks.check).not.toHaveBeenCalled();
    await act(async () => pending.resolve(order("A")));
    await screen.findByText("Đủ NVL");
    expect(mocks.detail).toHaveBeenCalledWith("A");
    expect(mocks.check).toHaveBeenCalledWith("xtb", [expect.objectContaining({ productId: "A", plannedQty: 1 })]);
    expect(screen.getByRole("button", { name: "Hoàn thành" })).toBeEnabled();
  });
  it("blocks completion when detail loading fails and retries without losing input", async () => {
    mocks.detail.mockRejectedValueOnce(new Error("detail unavailable")).mockResolvedValueOnce(order("A"));
    render(<CompleteProductionOrderDialog open order={{ ...order("A"), materials: undefined }} onOpenChange={vi.fn()} />);
    await screen.findByText("Chưa tải được nguyên liệu của lệnh. Thử lại trước khi hoàn tất.");
    expect(screen.getByRole("button", { name: "Hoàn thành" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Số lượng thực tế"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText("Đủ NVL");
    expect(screen.getByLabelText("Số lượng thực tế")).toHaveValue(12);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("does not check or display materials from a late detail response", async () => {
    const pending = deferred<ProductionOrder>();
    mocks.detail.mockReturnValueOnce(pending.promise);
    mocks.check.mockResolvedValue(checks("B"));
    const view = render(<CompleteProductionOrderDialog open order={{ ...order("A"), materials: undefined }} onOpenChange={vi.fn()} />);
    view.rerender(<CompleteProductionOrderDialog open order={order("B")} onOpenChange={vi.fn()} />);
    await screen.findByText("Đủ NVL");
    await act(async () => pending.resolve(order("A")));
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.check).toHaveBeenCalledWith("xtb", [expect.objectContaining({ productId: "B" })]);
  });
  it("shows loading without reporting ingredients as sufficient", async () => {
    const pending = deferred<ReturnType<typeof checks>>();
    mocks.check.mockReturnValue(pending.promise);
    render(<CompleteProductionOrderDialog open order={order("A")} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang kiểm tra nguyên liệu");
    expect(screen.queryByText("Đủ NVL")).toBeNull();
    await act(async () => pending.resolve(checks("A")));
    expect(screen.getByText("Đủ NVL")).toBeInTheDocument();
  });
  it("ignores the old order response after switching orders", async () => {
    const old = deferred<ReturnType<typeof checks>>();
    mocks.check.mockReturnValueOnce(old.promise).mockResolvedValueOnce(checks("B"));
    const view = render(<CompleteProductionOrderDialog open order={order("A")} onOpenChange={vi.fn()} />);
    view.rerender(<CompleteProductionOrderDialog open order={order("B")} onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Đủ NVL")).toBeInTheDocument());
    await act(async () => old.resolve(checks("OLD")));
    expect(screen.queryByText("OLD")).toBeNull();
    expect(screen.getAllByText("B").length).toBeGreaterThan(0);
  });
  it("reports a check failure and retries without resetting quantity", async () => {
    mocks.check.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(checks("A"));
    render(<CompleteProductionOrderDialog open order={order("A")} onOpenChange={vi.fn()} />);
    await screen.findByRole("alert");
    expect(screen.queryByText("Đủ NVL")).toBeNull();
    fireEvent.change(screen.getByLabelText("Số lượng thực tế"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText("Đủ NVL");
    expect(screen.getByLabelText("Số lượng thực tế")).toHaveValue(12);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("clears the previous check when the new order has no materials", async () => {
    const view = render(<CompleteProductionOrderDialog open order={order("A")} onOpenChange={vi.fn()} />);
    await screen.findByText("Đủ NVL");
    view.rerender(<CompleteProductionOrderDialog open order={order("B", false)} onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Đủ NVL")).toBeNull();
  });
  it("locks editing and dismissal while completion is pending", async () => {
    const pending = deferred<void>();
    mocks.complete.mockReturnValue(pending.promise);
    const close = vi.fn();
    render(<CompleteProductionOrderDialog open order={order("A")} onOpenChange={close} />);
    await screen.findByText("Đủ NVL");
    fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
    expect(screen.getByLabelText("Số lượng thực tế")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hủy" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(close).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    expect(close).toHaveBeenCalledWith(false);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
  it("keeps entered quantity when the server refuses completion", async () => {
    mocks.complete.mockRejectedValue(new Error("FNB_BRANCH_COST_REQUIRED"));
    render(<CompleteProductionOrderDialog open order={order("A")} onOpenChange={vi.fn()} />);
    await screen.findByText("Đủ NVL");
    fireEvent.change(screen.getByLabelText("Số lượng thực tế"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" })));
    expect(screen.getByLabelText("Số lượng thực tế")).toHaveValue(12);
    expect(screen.getByRole("button", { name: "Hoàn thành" })).toBeEnabled();
  });
});
