import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RestaurantTable } from "@/lib/types/fnb";

const mocks = vi.hoisted(() => ({
  zones: vi.fn(),
  tables: vi.fn(),
  decorations: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/services", () => ({
  getFloorPlanZones: mocks.zones,
  getTablesByZone: mocks.tables,
  getDecorationsByZone: mocks.decorations,
}));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({ currentBranch: { id: "xtb" }, user: { id: "cashier" }, tenant: { id: "tenant" } }),
}));
vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("next/dynamic", () => ({
  default: () => function Canvas(props: {
    tables: Array<{ id: string; name: string }>;
    onSelectTable: (table: { id: string; name: string }) => void;
  }) {
    return <div>{props.tables.map((table) => (
      <button key={table.id} onClick={() => props.onSelectTable(table)}>{table.name}</button>
    ))}</div>;
  },
}));
vi.mock("@/components/shared/floor-plan/table-action-sheet", () => ({
  TableActionSheet: ({ table, zoneName }: { table: unknown; zoneName?: string }) =>
    table ? <div data-testid="action-zone">{zoneName}</div> : null,
}));

import { TableFloorPlan } from "@/app/pos/fnb/components/table-floor-plan";
import type { FnbOpenOrder } from "@/lib/fnb-open-orders";

const tables = [
  { id: "inside-1", tableNumber: 1, name: "Ban 1", zone: "Trong Nha", status: "available", capacity: 2 },
  { id: "outside-10", tableNumber: 10, name: "Ban 10", zone: "Ngoai San", status: "available", capacity: 2 },
] as RestaurantTable[];

function layout(id: string) {
  return [{ id, shape: "square", width: 60, height: 60, positionX: 0, positionY: 0 }];
}

describe("POS floor plan keeps table actions in the selected zone", () => {
  it("opens unpaid takeaway and delivery bills directly in their own area", async () => {
    mocks.tables.mockResolvedValue(layout("inside-1"));
    const openOrder = vi.fn();
    const orders = [{id:"takeaway",orderNumber:"KB1",orderType:"takeaway",status:"pending",provisionalTotal:30000,itemCount:1,createdAt:"2026-10-07T08:00:00Z"},{id:"delivery",orderNumber:"KB2",orderType:"delivery",status:"ready",provisionalTotal:50000,itemCount:2,createdAt:"2026-10-07T08:00:00Z"},{id:"paid",orderNumber:"KB3",orderType:"takeaway",status:"served",invoiceId:"paid-invoice",provisionalTotal:50000,itemCount:1,createdAt:"2026-10-07T08:00:00Z"}] as FnbOpenOrder[];
    render(<TableFloorPlan tables={tables} onSelectTable={vi.fn()} openOrders={orders} onOpenOrder={openOrder} />);
    await screen.findByRole("button",{name:"Ban 1"});
    fireEvent.click(screen.getByRole("button",{name:"Mang về / Giao hàng (2)"}));
    expect(screen.queryByRole("button",{name:"Ban 1"})).not.toBeInTheDocument();
    expect(screen.queryByText(/KB3/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:/Mang về · KB1/}));
    expect(openOrder).toHaveBeenCalledWith(orders[0]);
    fireEvent.click(screen.getByRole("button",{name:/Giao hàng · KB2/}));
    expect(openOrder).toHaveBeenLastCalledWith(orders[1]);
  });
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.zones.mockResolvedValue([
      { id: "inside", name: "Trong Nha", width: 1000, height: 700 },
      { id: "outside", name: "Ngoai San", width: 1000, height: 700 },
    ]);
    mocks.decorations.mockResolvedValue([]);
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe() { this.callback([{ contentRect: { width: 1000 } }]); }
      disconnect() {}
    });
  });

  it("hides the previous zone's tables until the new zone resolves", async () => {
    let resolveOutside!: (value: ReturnType<typeof layout>) => void;
    mocks.tables.mockImplementation((zone: string) => zone === "inside"
      ? Promise.resolve(layout("inside-1"))
      : new Promise((resolve) => { resolveOutside = resolve; }));
    render(<TableFloorPlan tables={tables} onSelectTable={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Ban 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ngoai San" }));
    expect(screen.queryByRole("button", { name: "Ban 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ngoai San");
    await act(async () => resolveOutside(layout("outside-10")));
    expect(await screen.findByRole("button", { name: "Ban 10" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not label a list action with the last canvas zone", async () => {
    mocks.tables.mockResolvedValue(layout("inside-1"));
    render(<TableFloorPlan tables={tables} onSelectTable={vi.fn()} />);
    await screen.findByRole("button", { name: "Ban 1" });
    fireEvent.click(screen.getByRole("button", { name: "Danh sách" }));
    fireEvent.click(screen.getByRole("button", { name: /10\s*Ban 10/ }));
    expect(screen.getByTestId("action-zone")).toHaveTextContent("Ngoai San");
  });

  it("searches all zones from the plan and retains numeric table order", async () => {
    mocks.tables.mockResolvedValue(layout("inside-1"));
    render(<TableFloorPlan tables={[...tables].reverse()} onSelectTable={vi.fn()} />);
    await screen.findByRole("button", { name: "Ban 1" });
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm bàn" }), { target: { value: "Ngoai" } });
    expect(screen.getByRole("button", { name: /10\s*Ban 10/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^1\s*Ban 1Trống/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm bàn" }), { target: { value: "" } });
    const buttons = screen.getAllByRole("button").filter(button => /^\d/.test(button.textContent ?? ""));
    expect(buttons.map(button => button.textContent)).toEqual([
      expect.stringContaining("1Ban 1"), expect.stringContaining("10Ban 10"),
    ]);
  });

  it("filters serving tables without changing their status or opening orders", async () => {
    mocks.tables.mockResolvedValue(layout("inside-1"));
    const onSelect = vi.fn();
    render(<TableFloorPlan tables={[tables[0], { ...tables[1], status: "occupied" }]} onSelectTable={onSelect} />);
    await screen.findByRole("button", { name: "Ban 1" });
    fireEvent.click(screen.getByRole("button", { name: "Đang phục vụ (1)" }));
    expect(screen.getByRole("button", { name: /10\s*Ban 10/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^1\s*Ban 1Trống/ })).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tất cả (2)" }));
    expect(screen.getByRole("button", { name: /^1\s*Ban 1Trống/ })).toBeInTheDocument();
  });
  it("updates provisional totals on serving tables without opening an order", async () => {
    mocks.zones.mockResolvedValue([]);
    const serving = [{ ...tables[1], status: "occupied" as const }];
    const onSelect = vi.fn();
    const view = render(<TableFloorPlan tables={serving} tableTotals={{"outside-10":47000}} onSelectTable={onSelect} />);
    const table = await screen.findByRole("button", {name:/10\s*Ban 10/});
    expect(table).toHaveTextContent("Tạm tính");
    expect(table.textContent).toContain("47");
    view.rerender(<TableFloorPlan tables={serving} tableTotals={{"outside-10":72000}} onSelectTable={onSelect} />);
    expect(table.textContent).toContain("72");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("restores the explicitly selected list after leaving and remounting the floor plan", async () => {
    mocks.tables.mockResolvedValue(layout("inside-1"));
    const first = render(<TableFloorPlan tables={tables} onSelectTable={vi.fn()} />);
    await screen.findByRole("button", { name: "Ban 1" });
    fireEvent.click(screen.getByRole("button", { name: "Danh sách" }));
    first.unmount();
    render(<TableFloorPlan tables={tables} onSelectTable={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Danh sách" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^1\s*Ban 1Trống/ })).toBeInTheDocument();
  });

});
