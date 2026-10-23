import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ready: true, loading: false, permitted: false,
  user: { id: "actor-a", fullName: "Demo" } as { id: string; fullName: string } | null,
  read: vi.fn(),
}));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({ user: state.user }),
  useBranchFilter: () => ({ activeBranchId: "branch-a", currentBranch: { name: "Demo" }, isReady: state.ready }),
}));
vi.mock("@/lib/permissions/use-permission", () => ({
  usePermissions: () => ({ hasPermission: () => state.permitted, isLoading: state.loading }),
}));
vi.mock("@/lib/services", () => ({
  getDashboardKpis: (...args: unknown[]) => state.read("kpis", ...args),
  getFinancialAlerts: (...args: unknown[]) => state.read("alerts", ...args),
  getManagerLowStockProducts: (...args: unknown[]) => state.read("stock", ...args),
  getOrdersByWeekday: (...args: unknown[]) => state.read("orders", ...args),
  getRecentActivities: (...args: unknown[]) => state.read("activities", ...args),
  getRevenueByDay: (...args: unknown[]) => state.read("days", ...args),
  getRevenueByHour: (...args: unknown[]) => state.read("hours", ...args),
  getStockoutForecast: (...args: unknown[]) => state.read("forecast", ...args),
  getTopProducts: (...args: unknown[]) => state.read("products", ...args),
}));
import ManagerPwaPage from "@/app/manager/page";

beforeEach(() => {
  vi.clearAllMocks(); state.ready = true; state.loading = false; state.permitted = false;
  state.user = { id: "actor-a", fullName: "Demo" };
  state.read.mockResolvedValue([]);
});
afterEach(cleanup);

describe("manager data access gate", () => {
  it.each(["denied", "pending", "branch", "anonymous"])("does not fetch while access is %s", (condition) => {
    state.permitted = condition !== "denied";
    if (condition === "pending") state.loading = true;
    if (condition === "branch") state.ready = false;
    if (condition === "anonymous") state.user = null;
    render(<ManagerPwaPage />);
    expect(state.read).not.toHaveBeenCalled();
  });

  it("starts loading only after permission resolution", async () => {
    state.loading = true; state.permitted = true;
    state.read.mockImplementation((kind: string) => Promise.resolve(kind === "kpis" ? null : []));
    const view = render(<ManagerPwaPage />);
    expect(state.read).not.toHaveBeenCalled();
    state.loading = false;
    view.rerender(<ManagerPwaPage />);
    await waitFor(() => expect(state.read).toHaveBeenCalledTimes(9));
    expect(state.read).toHaveBeenCalledWith("kpis", "branch-a");
    expect(state.read).toHaveBeenCalledWith("alerts", "branch-a");
  });
});
