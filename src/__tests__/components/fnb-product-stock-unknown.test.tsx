import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: () => ({
  getVirtualItems: () => [{ index: 0, start: 0, size: 104, key: "row" }],
  getTotalSize: () => 104,
  measure: () => {},
}) }));
import { FnbProductGrid, type FnbProduct } from "@/app/pos/fnb/components/fnb-product-grid";

vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
const product: FnbProduct = { id: "coffee", name: "Cà phê", code: "CAFE", sell_price: 25000, stock: null, category_id: null };
afterEach(cleanup);
describe("F&B menu with unavailable stock", () => {
  it("keeps a made-to-order item selectable when its stock is hidden", () => {
    const select = vi.fn();
    render(<FnbProductGrid products={[product]} onSelectProduct={select} />);
    fireEvent.click(screen.getByRole("button", { name: /Cà phê/ }));
    expect(select).toHaveBeenCalledWith(product);
  });
  it("shows unknown instead of a false out-of-stock status when stock display is enabled", () => {
    render(<FnbProductGrid products={[product]} onSelectProduct={vi.fn()} enforceStock />);
    expect(screen.getByText("Chưa xác định")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cà phê/ })).toBeDisabled();
  });
});
