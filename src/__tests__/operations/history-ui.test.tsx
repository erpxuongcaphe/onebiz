import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OperationsHistoryPanel } from "@/components/operations/history";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Hub history in the current settings screen", () => {
  it("loads only when opened and describes the actor and schedule in Vietnamese", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [{
      id: "event-1", title: "Kiểm tra cuối quý", actor_name: "CEO", action: "configure_schedule", created_at: "2026-10-17T03:00:00Z", reason: "Chuyển lịch sang cuối quý",
      before_schedule: { frequency: "weekly", day_number: 1, due_time: "17:00", effective_from: "2026-10-17" },
      after_schedule: { frequency: "quarterly", day_number: 31, month_number: 3, due_time: "23:59", effective_from: "2026-10-17", effective_until: "2026-12-31" },
    }], next: null }) });
    vi.stubGlobal("fetch", fetch);
    render(<OperationsHistoryPanel branch="branch" period="2026-10"/>);
    expect(fetch).not.toHaveBeenCalled();
    const summary = screen.getByText("Nhật ký thao tác");
    fireEvent.click(summary);
    fireEvent(summary.parentElement!, new Event("toggle"));
    expect(await screen.findByText("Kiểm tra cuối quý")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Xem lịch thực hiện"));
    expect(screen.getByText("Trước thay đổi")).toBeVisible();
    expect(screen.getByText("Sau thay đổi")).toBeVisible();
    expect(screen.getByText(/Ngày 31, tháng thứ 3 mỗi quý/)).toHaveTextContent("23:59");
    expect(screen.getByText(/đến 31\/12\/2026/)).toBeVisible();
  });
});
