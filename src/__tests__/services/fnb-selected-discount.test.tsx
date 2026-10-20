import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DiscountRow } from "@/app/pos/fnb/components/fnb-cart";
import { fnbDiscountCartKey, fnbManualDiscountAmount } from "@/lib/fnb-manual-discount";
import { fnbDiscountContext } from "@/lib/manager-discount-context";
import type { FnbOrderLine } from "@/lib/types/fnb";
import { DeliveryDispatchCard } from "@/components/shared/fnb-delivery-dispatch";
import type { DeliveryDispatchOrder } from "@/lib/services/supabase/fnb-delivery-dispatch";

afterEach(cleanup);
const lines: FnbOrderLine[] = [
  { id: "one", productId: "coffee", productName: "Cà phê", quantity: 2, unitPrice: 25000, toppings: [{ productId: "milk", name: "Sữa", quantity: 1, price: 5000 }], lineTotal: 60000 },
  { id: "two", productId: "tea", productName: "Trà đào", quantity: 1, unitPrice: 40000, toppings: [], lineTotal: 40000 },
];
describe("item-specific manual discount", () => {
  it("selects rows and stages the value until Apply, including amount and percentage", () => {
    const onChange = vi.fn(); render(<DiscountRow lines={lines} discount={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Chọn món giảm giá" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Giá trị giảm giá" }), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Giảm giá theo phần trăm" }));
    expect(screen.getByRole("button", { name: "Áp dụng giảm giá" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Cà phê/ }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng giảm giá" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ mode: "percent", value: 25, lineIds: ["one"] });
  });
  it("reduces only selected rows, includes toppings, caps by available bill and handles missing rows", () => {
    expect(fnbManualDiscountAmount(lines, { mode: "percent", value: 25, lineIds: ["one"] })).toBe(15000);
    expect(fnbManualDiscountAmount(lines, { mode: "amount", value: 70000, lineIds: ["one"] })).toBe(60000);
    expect(fnbManualDiscountAmount(lines, { mode: "amount", value: 70000, lineIds: ["one"] }, 80000)).toBe(20000);
    expect(fnbManualDiscountAmount(lines, { mode: "percent", value: 25, lineIds: [] })).toBe(0);
    expect(fnbManualDiscountAmount(lines, { mode: "percent", value: 25, lineIds: ["removed"] })).toBe(0);
    expect(fnbManualDiscountAmount(lines, { mode: "percent", value: 25 })).toBe(25000);
  });
  it("binds scope and exact sent item identity in the request; approval key changes with cart edits", () => {
    const sent = [{ ...lines[0], kitchenOrderItemId: "server-one" }, lines[1]];
    const context = fnbDiscountContext("b", "tab", "Bill", "order", sent, 100000, { mode: "percent", value: 25, lineIds: ["one"] });
    expect(context).toMatchObject({ amount: 15000, discount_scope: "items", discount_mode: "percent", discount_value: 25 });
    expect(context.items[0]).toMatchObject({ discount_selected: true, kitchen_item_id: "server-one" });
    expect(context.items[1]).toMatchObject({ discount_selected: false });
    expect(fnbDiscountCartKey(lines)).toBe(fnbDiscountCartKey([...lines].reverse()));
    expect(fnbDiscountCartKey(lines)).not.toBe(fnbDiscountCartKey([{ ...lines[0], quantity: 1 }, lines[1]]));
  });
});

const row: DeliveryDispatchOrder = { id: "order", order_number: "GH-001", invoice_id: null, delivery_fee: 5000, delivery_staff_id: null, staff_name: null, recipient: "Khách thử", address: "123 Đường thử", phone: "0900000000", delivery_assigned_at: null, delivery_completed_at: null, created_at: "2026-10-20T01:00:00Z", note: null, total_count: 1 };
describe("delivery dispatch actions", () => {
  it("stages destination edits and requires explicit save; unassigned order cannot complete", () => {
    const save = vi.fn(); render(<DeliveryDispatchCard row={row} staff={[{ id: "staff", name: "Nhân viên thử" }]} canAssign canComplete busy={false} onSave={save} onAssign={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Xác nhận đã giao xong" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sửa thông tin nhận hàng" }));
    fireEvent.change(screen.getByLabelText("Địa chỉ giao hàng"), { target: { value: "456 Đường mới" } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Lưu thông tin nhận hàng" }));
    expect(save).toHaveBeenCalledExactlyOnceWith("Khách thử", "0900000000", "456 Đường mới");
  });
  it("keeps delivery completion separate from paid status and locks completed delivery controls", () => {
    render(<DeliveryDispatchCard row={{ ...row, invoice_id: "invoice", delivery_staff_id: "staff", staff_name: "A", delivery_completed_at: "2026-10-20T02:00:00Z" }} staff={[]} canAssign canComplete busy={false} onSave={vi.fn()} onAssign={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByText(/Đã giao xong · Đã thanh toán/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Người giao GH-001" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Xác nhận đã giao xong" })).toBeDisabled();
  });
});
