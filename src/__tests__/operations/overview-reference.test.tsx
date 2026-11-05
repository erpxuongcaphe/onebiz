import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QualityOverview } from "@/components/operations/quality-overview";
import type { QualityWorkspace } from "@/lib/operations/quality-contracts";

vi.mock("@/components/ui/icon", () => ({Icon: () => null}));
const branch = "11111111-1111-4111-8111-111111111111";
const rows = Array.from({length: 12}, (_, index) => ({id: `run-${index}`, code: `WS-${index + 1}`, title: `Công việc ${index + 1}`, category: "group:space", quality: "unknown", original_due_at: "2026-11-05T16:59:00Z", manager_ids: ["a", "b"]}));
const data = {groups: [{id: "space", title: "Không gian và trải nghiệm"}], assignments: [], score: {official: false, score: null, completedAudits: 0, rewardReady: false, rewardCents: null}, issueSummary: {awaiting: 3}, settlement: null, can: {manage: true, work: false, qc: false}, business: {ready: false}} as unknown as QualityWorkspace;
const fetchMock = vi.fn();
function response(url: string) {
  const params = new URL(url, "http://local").searchParams;
  return {ok: true, json: async () => ({rows, total: params.get("overdue") === "true" ? 10 : params.get("result") === "unknown" ? 80 : params.get("result") === "met" ? 15 : 100})};
}
function show(props: Partial<React.ComponentProps<typeof QualityOverview>> = {}) {
  const onNavigate = vi.fn();
  return {...render(<QualityOverview data={data} branch={branch} period="2026-11" people={[{id: "a", name: "Quản lý A"}, {id: "b", name: "Quản lý B"}]} onNavigate={onNavigate} {...props}/>), onNavigate};
}
beforeEach(() => {
  vi.useFakeTimers({toFake: ["Date"]});
  vi.setSystemTime(new Date("2026-11-05T03:00:00Z"));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string) => response(url));
});
afterEach(() => {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks();});

describe("Hub overview from the supplied reference", () => {
  it("uses bounded authorized reads and exact totals instead of the first page", async () => {
    show();
    await screen.findByRole("button", {name: /Cần kiểm tra.*80/});
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url, options] of fetchMock.mock.calls) {
      const params = new URL(url, "http://local").searchParams;
      expect(params.get("branch")).toBe(branch);
      expect(params.get("from")).toBe("2026-11-04T17:00:00.000Z");
      expect(params.get("to")).toBe("2026-11-05T17:00:00.000Z");
      expect(options.method).toBeUndefined();
    }
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
    const results = screen.getByLabelText("Kết quả tự kiểm tra");
    expect(within(results).getByText("15")).toBeInTheDocument();
    expect(within(results).getByText("5")).toBeInTheDocument();
    expect(screen.getByText("8 / 80 công việc")).toBeInTheDocument();
    expect(screen.queryByText("9. Công việc 9")).toBeNull();
    expect(screen.getByRole("button", {name: /Quá hạn chưa kiểm tra.*10/})).toBeInTheDocument();
  });
  it("preserves source group, criterion number and all assigned managers", async () => {
    const view = show();
    await screen.findByRole("table");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("Nhóm công việc");
    expect(within(table).getAllByText("Không gian và trải nghiệm")).toHaveLength(8);
    expect(within(table).getByText("1. Công việc 1")).toBeInTheDocument();
    expect(within(table).getAllByText("Quản lý A, Quản lý B")).toHaveLength(8);
    fireEvent.click(within(table).getByRole("button", {name: "Chi tiết: Công việc 1"}));
    expect(view.onNavigate).toHaveBeenCalledWith("work", {preset: "today", result: "unknown", search: "Công việc 1", taskId: "run-0"});
    expect(screen.queryByRole("button", {name: "Ghi kết quả"})).toBeNull();
  });
  it("filters overdue unchecked work without classifying it as failed", async () => {
    const view = show();
    fireEvent.click(await screen.findByRole("button", {name: /Quá hạn chưa kiểm tra.*10/}));
    expect(screen.getByRole("button", {name: "Quá hạn"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("8 / 10 công việc")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Xem đầy đủ"}));
    expect(view.onNavigate).toHaveBeenCalledWith("work", {preset: "today", result: "unknown", overdue: true});
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("keeps To-do and QC in the reference month, independent of the work range", async () => {
    const view = show();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", {name: /To-do chờ kiểm tra lại/}));
    expect(view.onNavigate).toHaveBeenLastCalledWith("issues", {periodOnly: true, state: "pending_review"});
    fireEvent.click(screen.getByRole("button", {name: /Kết quả QC chính thức/}));
    expect(view.onNavigate).toHaveBeenLastCalledWith("qc", {periodOnly: true});
    const reward = screen.getByRole("region", {name: "QC và điểm thưởng"});
    expect(within(reward).getAllByText("—")).toHaveLength(2);
    expect(within(reward).getByText("Chưa xác định")).toBeInTheDocument();
  });
  it("uses the same Vietnam week-to-date range as the existing work filters", async () => {
    const view = show();
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Khoảng công việc tổng quan"), {target: {value: "this_week"}});
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    const params = new URL(fetchMock.mock.calls[4][0], "http://local").searchParams;
    expect(params.get("from")).toBe("2026-11-01T17:00:00.000Z");
    expect(params.get("to")).toBe("2026-11-05T17:00:00.000Z");
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", {name: "Xem tất cả"}));
    expect(view.onNavigate).toHaveBeenLastCalledWith("work", {preset: "this_week"});
  });
  it("uses the selected historical month rather than today's dates", async () => {
    show({period: "2026-10"});
    await screen.findByRole("table");
    expect(screen.getByLabelText("Khoảng công việc tổng quan")).toHaveValue("period");
    const params = new URL(fetchMock.mock.calls[0][0], "http://local").searchParams;
    expect(params.get("from")).toBe("2026-09-30T17:00:00.000Z");
    expect(params.get("to")).toBe("2026-10-31T17:00:00.000Z");
  });
  it("does not retry failures automatically or replace unavailable counts with zero", async () => {
    fetchMock.mockResolvedValue({ok: false, json: async () => ({error: "Chưa có kết nối."})});
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa có kết nối.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("button", {name: /Cần kiểm tra 0 việc/})).toBeNull();
    fetchMock.mockImplementation(async (url: string) => response(url));
    fireEvent.click(screen.getByRole("button", {name: "Thử lại"}));
    await screen.findByRole("table");
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
  it("debounces search, searches on the server and clears filters without leaving the branch", async () => {
    show();
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Tìm công việc tổng quan"), {target: {value: "pha chế"}});
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    const params = new URL(fetchMock.mock.calls[4][0], "http://local").searchParams;
    expect(params.get("search")).toBe("pha chế");
    expect(params.get("branch")).toBe(branch);
    fireEvent.click(screen.getByRole("button", {name: "Tất cả"}));
    expect(screen.getByLabelText("Tìm công việc tổng quan")).toHaveValue("");
    await screen.findByText("8 / 100 công việc");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
  it("ignores aborted responses when changing branch", async () => {
    let finish!: (value: unknown) => void;
    fetchMock.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    const view = show();
    const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    fetchMock.mockImplementation(async (url: string) => response(url));
    view.rerender(<QualityOverview data={data} branch="22222222-2222-4222-8222-222222222222" period="2026-11" onNavigate={vi.fn()}/>);
    await screen.findByRole("table");
    expect(oldSignal.aborted).toBe(true);
    await act(async () => finish({ok: true, json: async () => ({rows: [], total: 99999})}));
    expect(screen.queryByText(/99,999/)).toBeNull();
  });
  it("shows an empty schedule without claiming that its quality is met", async () => {
    fetchMock.mockResolvedValue({ok: true, json: async () => ({rows: [], total: 0})});
    show();
    await screen.findByText("Chưa có lịch công việc trong khoảng chọn");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.queryByText("100%")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("reuses a complete page for result counts without an extra API read", async () => {
    const complete = rows.map((row, index) => ({...row, quality: index < 3 ? "met" : index === 3 ? "unmet" : "unknown"}));
    fetchMock.mockImplementation(async (url: string) => {
      const params = new URL(url, "http://local").searchParams;
      const filtered = params.get("overdue") ? [] : params.get("result") === "unknown" ? complete.slice(4) : complete;
      return {ok: true, json: async () => ({rows: filtered, total: filtered.length})};
    });
    show();
    await screen.findByRole("table");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const results = screen.getByLabelText("Kết quả tự kiểm tra");
    expect(within(results).getByText("3")).toBeInTheDocument();
    expect(within(results).getByText("1")).toBeInTheDocument();
  });
  it("does not suggest closing a current period even when rewards can be calculated", async () => {
    show({data: {...data, score: {...data.score, official: true, score: 95, rewardReady: true}}});
    const readiness = screen.getByRole("region", {name: "Điều kiện chốt kỳ"});
    expect(within(readiness).getByText("Chưa đủ")).toBeInTheDocument();
    expect(within(readiness).getByText("Chờ hết ngày 30/11/2026")).toBeInTheDocument();
    expect(within(readiness).queryByText("Có thể xem trước")).toBeNull();
    await screen.findByRole("table");
  });
});
