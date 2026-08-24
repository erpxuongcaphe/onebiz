import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { FnbPinHandoverDialog } from "@/app/pos/fnb/components/fnb-pin-handover-dialog";

describe("FnbPinHandoverDialog", () => {
  it("giu gio theo chi nhanh, khong chuyen chu ca hay tien quy", () => {
    const onCloseShiftFirst = vi.fn();
    const onContinue = vi.fn();

    render(
      <FnbPinHandoverDialog
        open
        onOpenChange={vi.fn()}
        cashierName="Thu ngan A"
        onCloseShiftFirst={onCloseShiftFirst}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByRole("heading", { name: "Bàn giao quầy" })).toBeTruthy();
    expect(screen.getByText(/Giỏ tạm của chi nhánh sẽ được giữ/)).toBeTruthy();
    expect(screen.getByText(/không chuyển ca, tiền quỹ/)).toBeTruthy();
    expect(screen.getByText(/mở ca của mình trước khi thanh toán/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Đóng ca trước" }));
    fireEvent.click(screen.getByRole("button", { name: "Bàn giao bằng PIN" }));

    expect(onCloseShiftFirst).toHaveBeenCalledOnce();
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
