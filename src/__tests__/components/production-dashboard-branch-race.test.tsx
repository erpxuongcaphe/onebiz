import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ready: false, branch: undefined as string | undefined }));
const services = vi.hoisted(() => ({ kpis: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({
  isReady: state.ready, activeBranchId: state.branch, branchLabel: state.branch ?? "Tất cả chi nhánh",
  currentBranch: { branchType: "store" },
}) }));
vi.mock("@/lib/hooks/use-product-uom", () => ({useProductUom:()=>({map:new Map(),units:new Map(),loading:false,error:''})}));
vi.mock("@/lib/services", () => ({
  getProductionKpis: services.kpis,
  getNvlStock: async () => [], getProductionTrend: async () => [],
  getTopOutputProducts: async () => [], getActiveProductionOrders: async () => [],
}));
vi.mock("@/app/(main)/phan-tich/_components", () => ({
  KpiCard: ({ label, value }: any) => <div>{label}: {value}</div>,
  ChartCard: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("recharts", () => {
  const Empty = () => null;
  return Object.fromEntries(["BarChart", "Bar", "XAxis", "YAxis", "CartesianGrid", "Tooltip", "Legend", "ResponsiveContainer"].map(key => [key, Empty]));
});
import Page from "@/app/(main)/san-xuat/page";
afterEach(cleanup);

it("waits for auth scope and ignores an older branch response", async () => {
  let finishOld!: (value: any) => void;
  services.kpis.mockImplementation((branch: string) => branch === "old"
    ? new Promise(resolve => { finishOld = resolve; })
    : Promise.resolve({ ordersThisMonth: 7 }));
  const view = render(<Page />);
  expect(services.kpis).not.toHaveBeenCalled();
  state.ready = true;
  state.branch = "old";
  view.rerender(<Page />);
  await waitFor(() => expect(services.kpis).toHaveBeenCalledWith("old"));
  state.branch = "new";
  view.rerender(<Page />);
  await waitFor(() => expect(screen.getByText("Lệnh chế biến tháng này: 7")).toBeTruthy());
  await act(async () => { finishOld({ ordersThisMonth: 99 }); });
  expect(screen.queryByText("Lệnh chế biến tháng này: 99")).toBeNull();
  expect(screen.getByText("Phạm vi: new")).toBeTruthy();
});
