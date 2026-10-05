import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/services/supabase/fnb-menu-order", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/services/supabase/fnb-menu-order")>(), loadFnbMenuOrder: mocks.load, saveFnbMenuOrder: mocks.save }));
import { FnbMenuOrderDialog } from "@/app/pos/fnb/components/fnb-menu-order-dialog";
const original = { categories: [{ id: "coffee", name: "Cà phê", sort_order: 0 }, { id: "tea", name: "Trà", sort_order: 0 }], products: [{ id: "a", name: "Americano", category_id: "coffee", sort_order: 0 }, { id: "b", name: "Bạc sỉu", category_id: "coffee", sort_order: 0 }] };
describe("menu ordering dialog", () => {
  beforeEach(() => { mocks.load.mockReset().mockResolvedValue(original); mocks.save.mockReset().mockResolvedValue(undefined); });
  it("lets a manager preview changes and cancel without writing", async () => {
    const close = vi.fn();
    render(<FnbMenuOrderDialog onClose={close} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Đưa xuống: Cà phê" }));
    expect(screen.getByRole("button", { name: "Lưu thứ tự" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(close).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("retains edits and shows the server error when saving fails", async () => {
    mocks.save.mockRejectedValue(new Error("Thực đơn đã được người khác sửa"));
    const close = vi.fn(), saved = vi.fn();
    render(<FnbMenuOrderDialog onClose={close} onSaved={saved} />);
    fireEvent.click(await screen.findByRole("button", { name: "Đưa xuống: Cà phê" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu thứ tự" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("người khác sửa");
    expect(close).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  });
  it("updates POS only after successful persistence", async () => {
    const close = vi.fn(), saved = vi.fn().mockResolvedValue(undefined);
    render(<FnbMenuOrderDialog onClose={close} onSaved={saved} />);
    fireEvent.click(await screen.findByRole("button", { name: "Món trong danh mục" }));
    await screen.findByRole("button", { name: "Đưa xuống: Americano" });
    fireEvent.click(screen.getByRole("button", { name: "Đưa xuống: Americano" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu thứ tự" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0][0]).toEqual(original);
    expect(saved.mock.calls[0][0].products.map((row: { id: string }) => row.id)).toEqual(["b", "a"]);
  });
});
