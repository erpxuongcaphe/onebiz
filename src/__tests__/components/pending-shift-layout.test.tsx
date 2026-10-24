import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/permissions", () => ({
  usePermissions: () => ({ hasPermission: () => true }),
  PERMISSIONS: { SHIFTS_RECONCILE_ANY: "shifts.reconcile_any", SHIFTS_RECONCILE_OWN_BRANCH: "shifts.reconcile_own_branch" },
}));
vi.mock("@/components/shared/permission-page", () => ({ PermissionPage: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/shared/shift/pending-shift-alert", () => ({ ReconcileShiftDialog: () => null }));
vi.mock("@/lib/services/supabase/shifts", () => ({ getPendingShifts: async () => [{
  id: "demo-shift", branchId: "demo-branch", branchName: "Chi nhánh mẫu", cashierId: "demo-cashier",
  cashierName: "Nhân viên mẫu", openedAt: "2026-10-22T00:00:00Z", autoMarkedPendingAt: null,
  startingCash: 100000, shiftDurationHours: 28,
}] }));
import PendingPage from "@/app/(main)/he-thong/ca-cho-doi-soat/page";

it("sizes shift columns by available content width and preserves unknown timestamps", async () => {
  render(<PendingPage />);
  const action = await screen.findByRole("button", { name: /Đối chiếu ngay/ });
  const grid = action.closest(".grid");
  expect(grid?.className).toContain("grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))]");
  expect(grid?.className).not.toMatch(/(?:sm|lg):grid-cols/);
  expect(screen.getByText("Chưa ghi nhận thời điểm")).toBeInTheDocument();
});
