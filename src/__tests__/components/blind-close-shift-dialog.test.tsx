import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Shift } from "@/lib/types/shift";

const access = vi.hoisted(() => ({ canReconcile: false, loading: false, preview: vi.fn() }));
vi.mock("@/lib/permissions", async (original) => ({
  ...await original<typeof import("@/lib/permissions")>(),
  usePermissions: () => ({ hasAny: () => access.canReconcile, isLoading: access.loading }),
}));
vi.mock("@/lib/services/supabase/shifts", () => ({ previewShiftClose: access.preview }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
import { CloseShiftDialog } from "@/app/pos/fnb/components/shift-dialog";

const shift: Shift = {
  id: "test-shift", tenantId: "test-tenant", branchId: "test-branch", cashierId: "test-cashier",
  status: "open", openedAt: "2026-10-22T01:00:00Z", closedAt: null,
  startingCash: 100, expectedCash: 999, actualCash: null, cashDifference: null,
  totalSales: 12345, totalOrders: 55, salesByMethod: { cash: 12345 }, note: null,
};
beforeEach(() => { access.canReconcile = false; access.loading = false; access.preview.mockReset(); });
afterEach(cleanup);

describe("blind cashier close", () => {
  it("does not request or render reconciliation totals for a cashier", () => {
    render(<CloseShiftDialog open currentShift={shift} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(access.preview).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Tiền mặt thực đếm (đ)")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();
    expect(screen.queryByText("Tiền mặt dự kiến")).not.toBeInTheDocument();
    expect(screen.queryByText("Doanh thu ròng theo phương thức")).not.toBeInTheDocument();
    expect(screen.queryByText(/12,345/)).not.toBeInTheDocument();
  });

  it("accepts an explicit zero count, confirms it and submits only once", async () => {
    let finish!: () => void;
    const submit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<CloseShiftDialog open currentShift={shift} onOpenChange={vi.fn()} onConfirm={submit} />);
    fireEvent.change(screen.getByLabelText("Tiền mặt thực đếm (đ)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    expect(screen.queryByText(/Chênh lệch/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đóng ca" }));
    fireEvent.click(screen.getByRole("button", { name: "Đang chốt ca..." }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(0, undefined);
    await act(async () => finish());
  });

  it("retains the entered count after an unsuccessful close", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("expected cash should not be shown"));
    render(<CloseShiftDialog open currentShift={shift} onOpenChange={vi.fn()} onConfirm={submit} />);
    fireEvent.change(screen.getByLabelText("Tiền mặt thực đếm (đ)"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đóng ca" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("expected cash");
    fireEvent.click(screen.getByRole("button", { name: "Xem lại" }));
    expect(screen.getByLabelText("Tiền mặt thực đếm (đ)")).toHaveValue("1,000");
    expect(access.preview).not.toHaveBeenCalled();
  });

  it("does not request a preview while permissions are unresolved", () => {
    access.loading = true; access.canReconcile = true;
    render(<CloseShiftDialog open currentShift={shift} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(access.preview).not.toHaveBeenCalled();
    expect(screen.queryByText("Đóng ca làm việc")).not.toBeInTheDocument();
  });

  it("retains reconciliation preview for an authorized manager", async () => {
    access.canReconcile = true;
    access.preview.mockResolvedValue({ startingCash: 100, cashIn: 200, cashOut: 0, expectedCash: 300,
      totalSales: 200, totalOrders: 1, salesByMethod: { cash: 200 }, cashEntries: [] });
    render(<CloseShiftDialog open currentShift={shift} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(await screen.findByText("Tiền mặt dự kiến")).toBeInTheDocument();
    expect(access.preview).toHaveBeenCalledWith("test-shift");
  });
});
