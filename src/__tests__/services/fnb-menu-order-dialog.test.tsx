import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/services/supabase/fnb-pos-layout", () => ({ loadFnbLayoutEditor: mocks.load, saveFnbPosLayout: mocks.save }));
import { FnbMenuOrderDialog } from "@/app/pos/fnb/components/fnb-menu-order-dialog";
const layout = { revision: 0, categoryIds: [], productIds: [], hiddenIds: [] };
const data = { layout, categories: [{ id: "coffee", name: "Cà phê", sort_order: 0 }, { id: "tea", name: "Trà", sort_order: 0 }], products: [{ id: "a", name: "Americano", category_id: "coffee", sort_order: 0 }, { id: "b", name: "Bạc sỉu", category_id: "coffee", sort_order: 0 }] };
const props = () => ({ branchId: "xtb", branchName: "Xưởng Tư Búa", onClose: vi.fn(), onSaved: vi.fn() });
describe("branch menu editor", () => {
  beforeEach(() => { mocks.load.mockReset().mockResolvedValue(data); mocks.save.mockReset().mockImplementation(async (_branch, _original, next) => ({ ...next, revision: 1 })); });
  it("does not mark tab/category navigation as an edit or write on cancel", async () => {
    const p = props(); render(<FnbMenuOrderDialog {...p} />);
    await screen.findByRole("button", { name: "Đưa xuống: Americano" });
    expect(screen.getByRole("button", { name: "Lưu bố trí" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Danh mục" }));
    expect(screen.getByRole("button", { name: "Lưu bố trí" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalled()); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("saves only the chosen branch, not the shared catalog", async () => {
    const p = props(); render(<FnbMenuOrderDialog {...p} />);
    fireEvent.click(await screen.findByRole("button", { name: "Đưa xuống: Americano" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu bố trí" }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0]).toBe("xtb");
    expect(mocks.save.mock.calls[0][2].productIds).toEqual(["b", "a"]);
    expect(p.onSaved.mock.calls[0][0].revision).toBe(1);
  });
  it("removes and restores a tile in the draft without deleting the product", async () => {
    render(<FnbMenuOrderDialog {...props()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Bỏ khỏi bố trí: Americano" }));
    expect(screen.queryByRole("button", { name: "Bỏ khỏi bố trí: Americano" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thêm món vào bố trí" }));
    fireEvent.click(screen.getByRole("button", { name: "Thêm vào bố trí: Americano" }));
    fireEvent.click(screen.getByRole("button", { name: "Về danh sách món" }));
    expect(screen.getByRole("button", { name: "Bỏ khỏi bố trí: Americano" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lưu bố trí" })).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("retains draft when a concurrent save is rejected", async () => {
    mocks.save.mockRejectedValue(new Error("Người khác vừa sửa bố trí"));
    const p = props(); render(<FnbMenuOrderDialog {...p} />);
    fireEvent.click(await screen.findByRole("button", { name: "Đưa xuống: Americano" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu bố trí" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Người khác");
    expect(p.onClose).not.toHaveBeenCalled(); expect(p.onSaved).not.toHaveBeenCalled();
  });
});
