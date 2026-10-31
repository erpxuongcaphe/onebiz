import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/services/supabase/orders", () => ({ closeSalesOrdersProcessing: (...args: unknown[]) => f.rpc(...args) }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: f.toast }) }));
import { BulkProcessingDialog } from "@/app/(main)/don-hang/dat-hang/bulk-processing-dialog";
const ids = ["off-page", "on-page"];
const preview = { orders: [{ id: ids[0], code: "DH000001", already_closed: false }, { id: ids[1], code: "DH000002", already_closed: false }], selected_count: 2, already_closed_count: 0, to_close_count: 2, applied: false };
beforeEach(() => { vi.clearAllMocks(); });
describe("bulk processing confirmation", () => {
  it("previews all selected IDs, then writes once only after explicit confirmation", async () => {
    f.rpc.mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...preview, applied: true });
    const done = vi.fn(); const close = vi.fn();
    render(<BulkProcessingDialog orderIds={ids} onClose={close} onDone={done} />);
    await screen.findByText("DH000001");
    expect(screen.getByText("DH000002")).toBeTruthy();
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith(ids);
    fireEvent.change(screen.getByRole("textbox", { name: "Lý do chung" }), { target: { value: "Đã xuất riêng theo quản lý" } });
    fireEvent.click(screen.getByRole("button", { name: "Đã xử lý 2 đơn" }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(f.rpc).toHaveBeenLastCalledWith(ids, { apply: true, reason: "Đã xuất riêng theo quản lý" });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("does not write when cancelled after preview", async () => {
    f.rpc.mockResolvedValue(preview); const close = vi.fn();
    render(<BulkProcessingDialog orderIds={ids} onClose={close} onDone={vi.fn()} />);
    await screen.findByText("DH000001");
    fireEvent.click(screen.getByRole("button", { name: /^Hủy$/ }));
    expect(close).toHaveBeenCalledTimes(1); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("shows a scope error and prevents applying an unverified set", async () => {
    f.rpc.mockRejectedValue(new Error("Có đơn ngoài chi nhánh bạn được phép xử lý."));
    render(<BulkProcessingDialog orderIds={ids} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Có đơn ngoài chi nhánh");
    expect(screen.getByRole("button", { name: "Đã xử lý 0 đơn" })).toBeDisabled();
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("keeps already processed orders explicit and makes no duplicate apply request", async () => {
    f.rpc.mockResolvedValue({ ...preview, orders: preview.orders.map(order => ({ ...order, already_closed: true })), already_closed_count: 2, to_close_count: 0 });
    render(<BulkProcessingDialog orderIds={ids} onClose={vi.fn()} onDone={vi.fn()} />);
    await screen.findByText("DH000001");
    expect(screen.getAllByText("Đã xử lý · giữ nguyên")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Đã xử lý 0 đơn" })).toBeDisabled();
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
});
