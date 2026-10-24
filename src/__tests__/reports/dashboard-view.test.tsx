import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ ready: true, branchId: "b1" as string | undefined, permissions: new Set<string>(), fetch: vi.fn() }));
const openBills = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/use-fnb-open-orders", () => ({ useFnbOpenOrders: openBills }));
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-view" /> }));
vi.mock("@/lib/contexts", () => ({
  useBranchFilter: () => ({ activeBranchId: state.branchId, isReady: state.ready }),
  useAuth: () => ({ user: { id: "u1" }, tenant: { id: "t1" }, branches: [{ id: "b1", name: "Quán A", branchType: "store" }, { id: "b2", name: "Quán B", branchType: "store" }], hasPermission: (key: string) => state.permissions.has(key) }),
}));
vi.mock("@/lib/hooks/use-report-scope", () => ({ useReportScope: () => ({ isReady: state.ready }) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: () => false }));
vi.mock("@/lib/hooks/use-receiving-view-memory", () => ({ useReceivingVietnamDay: () => "2026-10-20" }));
vi.mock("@/lib/services/supabase/dashboard-sales", () => ({ getSalesDashboard: state.fetch }));
import Dashboard from "@/app/(main)/page";
const sample = { sales: 111111, discounts: 5000, returns: 0, orders: 3, received: 121111, refunded: 10000, collected: 111111, methods: { cash: 100000, transfer: 11111 }, buckets: [], modes: [] };
beforeEach(() => { state.ready = true; state.branchId = "b1"; state.permissions = new Set(["pos_fnb.view_sales_summary", "reports.analytics", "reports.view_detail", "reports.view_profit"]); state.fetch.mockReset().mockResolvedValue(sample); });
afterEach(cleanup);
beforeEach(() => openBills.mockReset().mockReturnValue({ orders: [], loading: false, error: null, refresh: vi.fn() }));
describe("sales dashboard permission and scope", () => {
  it("uses completed invoice value, not collections or return-adjusted sales, for average order value", async () => {
    state.fetch.mockResolvedValueOnce({ ...sample, sales: 90000, returns: 20000, orders: 2, collected: 5000 });
    render(<Dashboard />);
    expect(await screen.findByTestId("average-order-value")).toHaveTextContent("55,000");
  });
  it("does not invent an average when the day has no completed invoices", async () => {
    state.fetch.mockResolvedValueOnce({ ...sample, sales: -20000, returns: 20000, orders: 0 });
    render(<Dashboard />);
    expect(await screen.findByTestId("average-order-value")).toHaveTextContent("—");
  });
  it("hides previously loaded totals if refresh fails and restores them only after retry succeeds", async () => {
    render(<Dashboard />);
    await screen.findByTestId("net-sales");
    state.fetch.mockRejectedValueOnce(new Error("Nguồn tạm lỗi"));
    fireEvent.click(screen.getByRole("button", { name: "Làm mới" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Nguồn tạm lỗi"));
    expect(screen.queryByTestId("net-sales")).not.toBeInTheDocument();
    expect(screen.queryByTestId("average-order-value")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByTestId("net-sales")).toHaveTextContent("111,111");
  });
  it("restores live unpaid bills independently of the sales day and chart", async () => {
    state.permissions.add("pos_fnb.view_orders");
    openBills.mockReturnValue({ orders: [{ id: "test-open-1", branchId: "b1", tableId: "table-1", tableName: "Bàn thử", orderNumber: "TEST-OPEN-001", orderType: "dine_in", createdAt: "2026-10-18T01:00:00Z", provisionalTotal: 100 }], loading: false, error: null, refresh: vi.fn() });
    render(<Dashboard />);
    expect(screen.getByTestId("unpaid-total")).toHaveTextContent("100");
    expect(screen.getByText("1 bill · 1 bàn")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Xem các bill chờ thu (1)"));
    expect(screen.getByText(/TEST-OPEN-001/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ngày bán hàng"), { target: { value: "2026-10-19" } });
    fireEvent.click(screen.getByRole("button", { name: "Tháng" }));
    expect(screen.getByTestId("unpaid-total")).toHaveTextContent("100");
    expect(openBills).toHaveBeenLastCalledWith("t1", "b1");
    await screen.findByTestId("net-sales");
  });
  it("allows the unpaid workspace without exposing completed sales totals", () => {
    state.permissions = new Set(["pos_fnb.view_orders", "pos_fnb.checkout"]);
    render(<Dashboard />);
    expect(screen.getByText("F&B · Chưa thanh toán")).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it("does not load unpaid bills without order access or unrestricted branch scope", () => {
    const view = render(<Dashboard />);
    expect(openBills).not.toHaveBeenCalled();
    state.permissions.add("pos_fnb.view_orders"); state.branchId = undefined;
    view.rerender(<Dashboard />);
    expect(openBills).not.toHaveBeenCalled();
  });
  it("does not present failed unpaid data as a zero balance", () => {
    state.permissions.add("pos_fnb.view_orders");
    openBills.mockReturnValue({ orders: [], loading: false, error: "Test failure", refresh: vi.fn() });
    render(<Dashboard />);
    expect(screen.getByTestId("unpaid-total")).toHaveTextContent("—");
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa tải được bill chưa thanh toán");
  });
  it("defaults to sales and compactly separates net sales from collections", async () => {
    render(<Dashboard />);
    expect(screen.getByRole("tab", { name: "Bán hàng" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByTestId("net-sales")).toHaveTextContent("111,111"));
    expect(screen.getByText("Thực thu sau hoàn")).toBeInTheDocument();
    expect(screen.queryByText("Chênh lệch thu−chi")).not.toBeInTheDocument();
    expect(state.fetch).toHaveBeenCalledWith("b1", "2026-10-20", "2026-10-20", "hour");
  });
  it("allows manager sales without any profit permission", async () => {
    state.permissions.delete("reports.view_profit"); render(<Dashboard />);
    expect(screen.queryByRole("tab", { name: "Kinh doanh" })).not.toBeInTheDocument();
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
  });
  it("does not fetch aggregate money for cashier even with cashbook permission", () => {
    state.permissions = new Set(["finance.view_cash_book", "pos_fnb.checkout"]); render(<Dashboard />);
    expect(screen.getByRole("link", { name: "Bán hàng F&B" })).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled(); expect(screen.queryByText("Doanh số thực tế")).not.toBeInTheDocument();
  });
  it("gives warehouse only its granted workspace", () => {
    state.permissions = new Set(["inventory.view"]); render(<Dashboard />);
    expect(screen.getByRole("link", { name: "Tồn kho" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bán hàng F&B" })).not.toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it("waits for the branch scope", () => {
    state.ready = false; render(<Dashboard />); expect(state.fetch).not.toHaveBeenCalled();
  });
  it("shows errors instead of fake zeros", async () => {
    state.fetch.mockRejectedValueOnce(new Error("Không đủ quyền")); render(<Dashboard />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Không đủ quyền"));
    expect(screen.queryByTestId("net-sales")).not.toBeInTheDocument();
  });
  it("hides old branch amounts immediately and discards stale responses", async () => {
    const view = render(<Dashboard />);
    await waitFor(() => expect(screen.getByTestId("net-sales")).toHaveTextContent("111,111"));
    let resolve!: (value: unknown) => void;
    state.fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    state.branchId = "b2"; view.rerender(<Dashboard />);
    expect(screen.queryByTestId("net-sales")).not.toBeInTheDocument();
    state.permissions.delete("pos_fnb.view_sales_summary"); view.rerender(<Dashboard />);
    await act(async () => resolve({ ...sample, sales: 222222 }));
    expect(screen.queryByTestId("net-sales")).not.toBeInTheDocument();
  });
  it("requires the all-branch permission rather than treating no branch as unrestricted", () => {
    state.branchId = undefined; render(<Dashboard />); expect(state.fetch).not.toHaveBeenCalled();
  });
  it("uses a full month for day view, capped at today", async () => {
    render(<Dashboard />); fireEvent.click(screen.getByRole("button", { name: "Ngày" }));
    await waitFor(() => expect(state.fetch).toHaveBeenLastCalledWith("b1", "2026-10-01", "2026-10-20", "day"));
    fireEvent.click(screen.getByRole("button", { name: "Năm" }));
    await waitFor(() => expect(state.fetch).toHaveBeenLastCalledWith("b1", "2022-01-01", "2026-10-20", "year"));
  });
  it("keeps today's zero sales when the chart shows monthly or yearly sales", async () => {
    state.fetch.mockImplementation((_branch, from, to) => Promise.resolve({ ...sample, sales: from === to ? 0 : 7444500 }));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByTestId("net-sales")).toHaveTextContent(/^0/));
    fireEvent.click(screen.getByRole("button", { name: "Ngày" }));
    await waitFor(() => expect(state.fetch).toHaveBeenLastCalledWith("b1", "2026-10-01", "2026-10-20", "day"));
    expect(screen.getByTestId("net-sales")).toHaveTextContent(/^0/);
    fireEvent.click(screen.getByRole("button", { name: "Năm" }));
    await waitFor(() => expect(state.fetch).toHaveBeenLastCalledWith("b1", "2022-01-01", "2026-10-20", "year"));
    expect(screen.getByTestId("net-sales")).toHaveTextContent(/^0/);
    expect(screen.getByLabelText("Ngày bán hàng")).toHaveValue("2026-10-20");
  });
  it("changes a single sales day without changing the chart date or grain", async () => {
    render(<Dashboard />);
    await screen.findByTestId("net-sales");
    fireEvent.click(screen.getByRole("button", { name: "Tháng" }));
    await waitFor(() => expect(state.fetch).toHaveBeenLastCalledWith("b1", "2026-01-01", "2026-10-20", "month"));
    fireEvent.change(screen.getByLabelText("Ngày bán hàng"), { target: { value: "2026-10-19" } });
    await waitFor(() => expect(state.fetch).toHaveBeenLastCalledWith("b1", "2026-10-19", "2026-10-19", "hour"));
    expect(screen.getByLabelText("Ngày tham chiếu biểu đồ")).toHaveValue("2026-10-20");
    expect(screen.getByRole("button", { name: "Tháng" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Hôm nay" }));
    await waitFor(() => expect(state.fetch).toHaveBeenLastCalledWith("b1", "2026-10-20", "2026-10-20", "hour"));
    expect(screen.getByRole("button", { name: "Tháng" })).toHaveAttribute("aria-pressed", "true");
  });
  it("keeps daily sales visible if a separate chart request fails", async () => {
    render(<Dashboard />);
    await screen.findByTestId("net-sales");
    state.fetch.mockRejectedValueOnce(new Error("Lỗi phân tích"));
    fireEvent.click(screen.getByRole("button", { name: "Ngày" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Biểu đồ: Lỗi phân tích"));
    expect(screen.getByTestId("net-sales")).toHaveTextContent("111,111");
  });
  it("changing the chart reference day never changes the daily summary", async () => {
    render(<Dashboard />);
    await screen.findByTestId("net-sales");
    state.fetch.mockResolvedValueOnce({ ...sample, sales: 999999 });
    fireEvent.change(screen.getByLabelText("Ngày tham chiếu biểu đồ"), { target: { value: "2026-10-19" } });
    await waitFor(() => expect(state.fetch).toHaveBeenLastCalledWith("b1", "2026-10-19", "2026-10-19", "hour"));
    expect(screen.getByTestId("net-sales")).toHaveTextContent("111,111");
    expect(screen.getByLabelText("Ngày bán hàng")).toHaveValue("2026-10-20");
  });
  it("does not lock refresh after leaving an in-flight chart period", async () => {
    render(<Dashboard />);
    await screen.findByTestId("net-sales");
    state.fetch.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Ngày" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Làm mới" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Giờ" }));
    expect(screen.getByRole("button", { name: "Làm mới" })).toBeEnabled();
  });
});
