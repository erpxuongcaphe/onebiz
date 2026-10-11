import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsFilterBar } from "@/components/operations/filter-bar";
import { initialFilters } from "@/lib/operations/filters";
import { useHubAccess } from "@/lib/operations/use-hub-access";

const session = vi.hoisted(() => ({ user: { id: "user-a" }, isLoading: false, hasPermission: vi.fn(() => true) }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => session }));
function Entry() { return <span>{useHubAccess() ? "Cho phép" : "Chặn"}</span>; }
beforeEach(() => { session.user = { id: "user-a" }; session.isLoading = false; session.hasPermission.mockReturnValue(true); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Hub filters and permission-dependent entry", () => {
  it("requires a valid date field, labels all custom date inputs and resets filters", () => {
    const value = { ...initialFilters("todo"), preset: "custom" as const, category: "maintenance" };
    const onChange = vi.fn();
    render(<OperationsFilterBar kind="todo" value={value} onChange={onChange} people={[]} period="2026-10" />);
    expect(screen.getByLabelText("Lọc theo ngày").querySelector('option[value=""]')).toBeNull();
    expect(screen.getByLabelText("Từ ngày")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Đến ngày")).toHaveAttribute("type", "date");
    expect(screen.getByRole("alert")).toHaveTextContent("Chọn đủ");
    fireEvent.click(screen.getByRole("button", { name: "Đặt lại" }));
    expect(onChange).toHaveBeenCalledWith(initialFilters("todo"));
  });
  it("does not show irrelevant criteria for policy settings", () => {
    render(<OperationsFilterBar kind="settings" settingsTarget="policies" value={initialFilters("settings")} onChange={vi.fn()} people={[]} period="2026-10" />);
    expect(screen.queryByText("Tiêu chí bổ sung")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Người chịu trách nhiệm")).not.toBeInTheDocument();
  });
  it("never requests access without Hub permission", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); session.hasPermission.mockReturnValue(false);
    render(<Entry />); expect(screen.getByText("Chặn")).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
  });
  it("only shows a shortcut after the server confirms the relationship", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ allowed: true }) }));
    const { rerender } = render(<Entry />); await waitFor(() => expect(screen.getByText("Cho phép")).toBeInTheDocument());
    session.hasPermission.mockReturnValue(false); rerender(<Entry />); expect(screen.getByText("Chặn")).toBeInTheDocument();
  });
  it("fails closed once, without retries, on server or network error", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetch);
    render(<Entry />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Chặn")).toBeInTheDocument();
  });
});
