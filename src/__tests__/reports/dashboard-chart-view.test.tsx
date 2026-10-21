import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("recharts", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    ResponsiveContainer: Wrapper, BarChart: Wrapper,
    AreaChart: ({ data, children }: { data: unknown; children?: ReactNode }) => <div data-testid="trend-data" data-points={JSON.stringify(data)}>{children}</div>,
    Area: Empty, Bar: Empty, CartesianGrid: Empty, Cell: Empty, Tooltip: Empty, XAxis: Empty, YAxis: Empty,
  };
});
import SalesOverviewCharts from "@/app/(main)/_sales-overview-charts";

const buckets = [
  { key: "2026-01-02T10:00:00", sales: 0, orders: 0 },
  { key: "2026-01-02T11:00:00", sales: 0, orders: 0 },
];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-02T03:59:30Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("sales chart presentation", () => {
  it("uses the same pending periods in chart and full data table", () => {
    render(<SalesOverviewCharts buckets={buckets} modes={[]} grain="hour" period="02/01/2026" />);
    const points = JSON.parse(screen.getByTestId("trend-data").getAttribute("data-points")!);
    expect(points[1]).toMatchObject({ sales: null, orders: null, pending: true });
    const row = screen.getByText("11h").closest("tr")!;
    expect(within(row).getByText("Chưa đến")).toBeInTheDocument();
    expect(within(row).getAllByText("—")).toHaveLength(2);
    expect(screen.getByText("Kỳ hiện tại chưa kết thúc.")).toBeInTheDocument();
  });

  it("advances the current hour without requesting or changing business data", () => {
    const { unmount } = render(<SalesOverviewCharts buckets={buckets} modes={[]} grain="hour" period="02/01/2026" />);
    act(() => vi.advanceTimersByTime(60_000));
    const row = screen.getByText("11h").closest("tr")!;
    expect(within(row).getByText("Đang diễn ra")).toBeInTheDocument();
    expect(within(row).queryByText("Chưa đến")).not.toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes time when returning to a background tab", () => {
    render(<SalesOverviewCharts buckets={buckets} modes={[]} grain="hour" period="02/01/2026" />);
    vi.setSystemTime(new Date("2026-01-02T04:01:00Z"));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(within(screen.getByText("11h").closest("tr")!).getByText("Đang diễn ra")).toBeInTheDocument();
  });
});
