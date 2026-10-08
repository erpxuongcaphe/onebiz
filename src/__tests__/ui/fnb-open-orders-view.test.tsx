import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FnbOpenOrdersDialog } from "@/app/pos/fnb/components/fnb-open-orders-dialog";
import type { FnbOpenOrder } from "@/lib/fnb-open-orders";

function check(id: string, orderType: FnbOpenOrder["orderType"]): FnbOpenOrder {
  return { id, orderType, orderNumber: `KB${id}`, tableName: "Bàn 9", createdByName: id === "001" ? "Đức" : "An", itemCount: 1, provisionalTotal: 22000 } as FnbOpenOrder;
}
function mount(overrides = {}) {
  const onOpenOrder = vi.fn();
  const onOpenChange = vi.fn();
  render(<FnbOpenOrdersDialog open orders={[check("001", "dine_in"), check("002", "dine_in"), check("003", "takeaway"), check("004", "delivery")]} drafts={[]} activeOrderId="002" onOpenOrder={onOpenOrder} onOpenChange={onOpenChange} onOpenDraft={vi.fn()} loading={false} error={null} connected busy={false} onRefresh={vi.fn()} updatedAt={null} {...overrides} />);
  return { onOpenOrder, onOpenChange };
}
describe("full POS unpaid checks view", () => {
  it("groups all branch checks without a modal and opens the exact split check", () => {
    const { onOpenOrder } = mount();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const dineIn = screen.getByRole("region", { name: "Tại quán" });
    const cards = within(dineIn).getAllByRole("button");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("aria-pressed", "false");
    expect(cards[1]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(cards[0]);
    expect(onOpenOrder.mock.calls[0][0].id).toBe("001");
    expect(within(screen.getByRole("region", { name: "Mang về" })).getAllByRole("button")).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Giao hàng" })).getAllByRole("button")).toHaveLength(1);
  });
  it("finds a bill by code and returns without selecting another bill", () => {
    const { onOpenChange, onOpenOrder } = mount();
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm đơn đang mở" }), { target: { value: "KB004" } });
    expect(within(screen.getByRole("region", { name: "Tại quán" })).queryByRole("button")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Giao hàng" })).getByRole("button")).toHaveTextContent("KB004");
    fireEvent.click(screen.getByRole("button", { name: /Quay lại POS/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenOrder).not.toHaveBeenCalled();
  });
  it("prevents bill selection while another bill is loading", () => {
    const { onOpenOrder } = mount({ busy: true });
    const card = within(screen.getByRole("region", { name: "Mang về" })).getByRole("button");
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(onOpenOrder).not.toHaveBeenCalled();
  });
  it("matches Vietnamese employee names with uppercase or unaccented input", () => {
    mount();
    for (const query of ["ĐỨC", "duc"]) {
      fireEvent.change(screen.getByRole("textbox", { name: "Tìm đơn đang mở" }), { target: { value: query } });
      const cards = within(screen.getByRole("region", { name: "Tại quán" })).getAllByRole("button");
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent("KB001");
    }
  });
});
