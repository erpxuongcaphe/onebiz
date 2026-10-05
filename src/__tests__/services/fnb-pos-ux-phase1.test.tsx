import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TableFloorPlan } from "@/app/pos/fnb/components/table-floor-plan";
import { FnbCategoryGrid } from "@/app/pos/fnb/components/fnb-category-grid";
import { FnbHeader } from "@/app/pos/fnb/components/fnb-header";
import type { FnbTabSnapshot, RestaurantTable } from "@/lib/types/fnb";

vi.mock("next/dynamic", () => ({ default: () => () => <div>Sơ đồ minh họa</div> }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ currentBranch: { id: "branch-1", name: "Quán thử", code: "TEST", branchType: "store" }, branches: [], switchBranch: vi.fn() }) }));
vi.mock("@/lib/contexts/toast-context", () => {
  const toast = vi.fn();
  return { useToast: () => ({ toast }) };
});
vi.mock("@/lib/services", () => ({
  getFloorPlanZones: vi.fn(async () => []),
  getTablesByZone: vi.fn(async () => []),
  getDecorationsByZone: vi.fn(async () => []),
}));

const makeTable = (id: string, number: number, status: RestaurantTable["status"]): RestaurantTable => ({
  id, tenantId: "tenant-1", branchId: "branch-1", tableNumber: number, name: "Bàn " + number,
  zone: number === 2 ? "Sân vườn" : "Trong quán", capacity: 4, status,
  currentOrderId: status === "occupied" ? "order-" + id : null, positionX: 0, positionY: 0,
  sortOrder: number, isActive: true, createdAt: "2026-10-05T00:00:00Z",
});

describe("FnB table list reuses the existing service actions", () => {
  it("searches by zone and opens the selected original table", async () => {
    const table1 = makeTable("one", 1, "available");
    const table2 = makeTable("two", 2, "occupied");
    const onSelectTable = vi.fn();
    render(<TableFloorPlan tables={[table1, table2]} onSelectTable={onSelectTable} />);
    fireEvent.click(screen.getByRole("button", { name: "Danh sách" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm bàn" }), { target: { value: "Sân vườn" } });
    expect(screen.queryByRole("button", { name: /Bàn 1/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Bàn 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Xem đơn" }));
    await waitFor(() => expect(onSelectTable).toHaveBeenCalledWith(table2));
  });

  it("keeps transfer unavailable without permission and reflects live status changes", () => {
    const table = makeTable("one", 1, "available");
    const { rerender } = render(<TableFloorPlan tables={[table]} onSelectTable={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Danh sách" }));
    rerender(<TableFloorPlan tables={[{ ...table, status: "occupied", currentOrderId: "order-1" }]} onSelectTable={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Bàn 1.*Đang phục vụ/ }));
    expect(screen.getByRole("button", { name: "Xem đơn" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chuyển bàn" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gộp đơn" })).not.toBeInTheDocument();
  });
});

describe("FnB mobile categories", () => {
  it("opens the picker, applies a category and returns space to the menu", () => {
    const onSelect = vi.fn();
    render(<FnbCategoryGrid categories={[{ id: "coffee", name: "Cà phê tươi", code: "CF", count: 10 }]} totalCount={10} activeCategoryId={null} onSelect={onSelect} />);
    const toggle = screen.getByRole("button", { name: /Danh mục/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /Cà phê tươi/ }));
    expect(onSelect).toHaveBeenCalledWith("coffee");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Cà phê tươi/ })).not.toBeInTheDocument();
  });
});

describe("FnB order tabs", () => {
  it("keeps closing a populated order separate from switching it and preserves confirmation", () => {
    const closeTab = vi.fn();
    const switchTab = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const tab: FnbTabSnapshot = { id: "order-1", label: "Mang về #1", orderType: "takeaway", customerName: "Khách lẻ", lines: [{ id: "line-1", productId: "coffee", productName: "Cà phê", quantity: 1, unitPrice: 30000, lineTotal: 30000, toppings: [] }] };
    render(<FnbHeader tabs={[tab]} activeTabId={tab.id} switchTab={switchTab} closeTab={closeTab} createTab={vi.fn()} onToggleFloorPlan={vi.fn()} onSearch={vi.fn()} />);
    const close = screen.getByRole("button", { name: "Đóng đơn Mang về #1" });
    expect(close.parentElement?.tagName).toBe("DIV");
    fireEvent.click(close);
    expect(closeTab).not.toHaveBeenCalled();
    expect(switchTab).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.keyDown(close, { key: " " });
    expect(closeTab).toHaveBeenCalledExactlyOnceWith(tab.id);
    expect(switchTab).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
