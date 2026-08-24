import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPosPinUsers, verifyPosPinAndSwitch } = vi.hoisted(() => ({
  listPosPinUsers: vi.fn(),
  verifyPosPinAndSwitch: vi.fn(),
}));

vi.mock("@/lib/services/supabase/pos-pin", () => ({
  listPosPinUsers,
  verifyPosPinAndSwitch,
}));

import { PosPinSwitchDialog } from "@/components/shared/dialogs/pos-pin-switch-dialog";

describe("PosPinSwitchDialog trên thiết bị chạm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPosPinUsers.mockResolvedValue([
      {
        id: "cashier-b",
        fullName: "Thu ngân B",
        role: "cashier",
        roleName: "Thu ngân",
        isLocked: false,
      },
    ]);
  });

  it("giữ hai nút xác nhận PIN ở vùng chạm 44px", async () => {
    render(
      <PosPinSwitchDialog
        open
        onOpenChange={vi.fn()}
        branchId="branch-xdc"
        currentUserId="cashier-a"
        onSwitched={vi.fn()}
      />,
    );

    const cashier = await screen.findByRole("button", { name: /Thu ngân B/ });
    fireEvent.click(cashier);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Xác nhận PIN" })).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "Chọn lại" }).className).toContain("h-11");
    expect(screen.getByRole("button", { name: "Xác nhận PIN" }).className).toContain("h-11");
    expect(verifyPosPinAndSwitch).not.toHaveBeenCalled();
  });
});
