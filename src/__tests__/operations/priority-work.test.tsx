import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PriorityWork } from "@/components/operations/priority-work";

const branch = "11111111-1111-4111-8111-111111111111";
const fetchMock = vi.fn();
const rows = Array.from({ length: 6 }, (_, index) => ({
  id: `task-${index}`, title: `Việc ${index + 1}`, quality: "unknown",
  original_due_at: "2026-10-01T16:59:00Z", manager_ids: ["manager"],
}));
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("overview priority work", () => {
  it("uses the same authorized overdue period query and shows at most five tasks", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows, total: 98 }) });
    const navigate = vi.fn();
    render(<PriorityWork branch={branch} period="2026-10" people={[{ id: "manager", name: "Quản lý A" }]} onNavigate={navigate} />);
    await screen.findByText("Việc 1");
    const url = new URL(fetchMock.mock.calls[0][0], "http://test");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ branch, kind: "work", overdue: "true", dateField: "due", from: "2026-09-30T17:00:00.000Z", to: "2026-10-31T17:00:00.000Z" });
    expect(screen.queryByText("Việc 6")).toBeNull();
    expect(screen.getAllByText("Quản lý A")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Xem danh sách quá hạn (98)" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Mở chi tiết" })[0]);
    expect(navigate).toHaveBeenCalledWith("work", { periodOnly: true, overdue: true, search: "Việc 1", taskId: "task-0" });
    expect(fetchMock.mock.calls.every(([, options]) => !options.method)).toBe(true);
  });
  it("does not automatically retry failed reads and offers a manual retry", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Tạm thời chưa tải được." }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [], total: 0 }) });
    render(<PriorityWork branch={branch} period="2026-10" onNavigate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Tạm thời chưa tải được.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(/Không có việc quá hạn cần xử lý/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keeps an empty priority list separate from the quality result", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows: [], total: 0 }) });
    render(<PriorityWork branch={branch} period="2026-10" onNavigate={vi.fn()} />);
    expect(await screen.findByText(/Việc hôm nay xem tại Công việc/)).toBeInTheDocument();
    expect(screen.queryByText("Đạt")).toBeNull();
  });
  it("ignores a late response from the previous branch", async () => {
    let resolveFirst!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [{ ...rows[0], title: "Việc chi nhánh mới" }], total: 1 }) });
    const view = render(<PriorityWork branch={branch} period="2026-10" onNavigate={vi.fn()} />);
    const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    view.rerender(<PriorityWork branch="22222222-2222-4222-8222-222222222222" period="2026-10" onNavigate={vi.fn()} />);
    await screen.findByText("Việc chi nhánh mới");
    expect(firstSignal.aborted).toBe(true);
    await act(async () => resolveFirst({ ok: true, json: async () => ({ rows: [{ ...rows[0], title: "Việc cũ không được hiện" }], total: 1 }) }));
    expect(screen.queryByText("Việc cũ không được hiện")).toBeNull();
  });
  it("aborts its read when leaving the overview", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const view = render(<PriorityWork branch={branch} period="2026-10" onNavigate={vi.fn()} />);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
