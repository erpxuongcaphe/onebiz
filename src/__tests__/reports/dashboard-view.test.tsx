import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ready: true, branchId: "b1",
  permissions: new Set(["reports.analytics", "reports.view_detail", "reports.view_profit"]),
  getDashboardKpis: vi.fn(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-view" /> }));
vi.mock("@/lib/contexts", () => ({
  useBranchFilter: () => ({ activeBranchId: state.branchId, isReady: state.ready }),
  useAuth: () => ({ user: { fullName: "Admin" }, tenant: { id: "t1" }, branches: [], hasPermission: (key: string) => state.permissions.has(key) }),
}));
vi.mock("@/lib/hooks/use-report-scope", () => ({ useReportScope: () => ({ isReady: state.ready }) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: () => false }));
vi.mock("@/lib/hooks/use-fnb-open-orders", () => ({ useFnbOpenOrders: () => ({ orders: [], loading: false, connected: false, error: null }) }));
vi.mock("@/lib/services", () => ({
  getDashboardKpis: state.getDashboardKpis,
  getRevenueByDay: async () => [], getRevenueByHour: async () => [],
  getRevenueByWeekday: async () => [], getOrdersByWeekday: async () => [],
  getTopProducts: async () => [], getLowStockProducts: async () => [],
  getRecentActivities: async () => [], getFinancialAlerts: async () => [],
}));
import Dashboard from "@/app/(main)/page";

beforeEach(() => {
  state.ready = true;
  state.branchId = "b1";
  state.permissions = new Set(["reports.analytics", "reports.view_detail", "reports.view_profit"]);
  state.getDashboardKpis.mockReset().mockResolvedValue({
    todayCollected: 0, yesterdayCollected: 0, todayRevenue: 0, yesterdayRevenue: 0,
    todayOrders: 0, yesterdayOrders: 0, todayProfit: 0, yesterdayProfit: 0,
    todayDiscounts: 0, todayDeliveryFee: 0, todayCash: 0, todayTransfer: 0,
    todayCard: 0, todayRefunds: 0,
  });
});
afterEach(cleanup);

describe("dashboard management views", () => {
  it("defaults to business without starting a second operational data feed", () => {
    render(<Dashboard />);
    expect(screen.getByRole("tab", { name: "Kinh doanh" })).toHaveAttribute("aria-selected", "true");
    expect(state.getDashboardKpis).not.toHaveBeenCalled();
  });

  it("loads operations only when selected", async () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("tab", { name: "Vận hành" }));
    await waitFor(() => expect(state.getDashboardKpis).toHaveBeenCalledWith("b1"));
    expect(screen.getByRole("tab", { name: "Vận hành" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps operations accessible without exposing profit to an unauthorized role", async () => {
    state.permissions.delete("reports.view_profit");
    render(<Dashboard />);
    expect(screen.queryByRole("tab", { name: "Kinh doanh" })).not.toBeInTheDocument();
    await waitFor(() => expect(state.getDashboardKpis).toHaveBeenCalledTimes(1));
  });

  it("does not fetch any dashboard data before the branch scope is ready", () => {
    state.ready = false;
    render(<Dashboard />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải tổng quan");
    expect(state.getDashboardKpis).not.toHaveBeenCalled();
  });

  it("shows an operational load failure instead of a valid-looking zero", async () => {
    state.getDashboardKpis.mockRejectedValueOnce(new Error("network unavailable"));
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("tab", { name: "Vận hành" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Chưa tải được số liệu vận hành"));
    expect(screen.queryByText("Thực thu")).not.toBeInTheDocument();
  });

  it("hides loaded KPIs immediately when the operational branch changes", async () => {
    const defaults = await state.getDashboardKpis();
    state.getDashboardKpis.mockClear().mockResolvedValueOnce({ ...defaults, todayRevenue: 111111 });
    const view = render(<Dashboard />);
    fireEvent.click(screen.getByRole("tab", { name: "Vận hành" }));
    await waitFor(() => expect(screen.getByText("111,111")).toBeInTheDocument());
    let resolve!: (value: unknown) => void;
    state.getDashboardKpis.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    state.branchId = "b2";
    view.rerender(<Dashboard />);
    expect(screen.queryByText("111,111")).not.toBeInTheDocument();
    await act(async () => { resolve({ ...defaults, todayRevenue: 222222 }); });
    expect(screen.getByText("222,222")).toBeInTheDocument();
  });
});
