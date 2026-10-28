import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseOrderLines } from "@/app/(main)/hang-hoa/dat-hang-nhap/purchase-order-lines";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/supabase/purchase-orders", () => ({ getPurchaseOrderItems: read }));
const rows = [{ id: "line", productName: "Đường cát", productCode: "DUONG-01", quantity: 2.5, unit: "Kg", note: "Giao buổi sáng" }];
describe("saved purchase request review", () => {
  beforeEach(() => read.mockReset());
  it("shows saved quantity, transaction unit and line note", async () => {
    read.mockResolvedValue(rows);
    render(<PurchaseOrderLines orderId="po-1" />);
    expect(await screen.findByText("Đường cát")).toBeVisible();
    for (const text of ["DUONG-01", "2.5", "Kg", "Giao buổi sáng"]) expect(screen.getByText(text)).toBeVisible();
    expect(read).toHaveBeenCalledWith("po-1");
  });
  it("does not disguise a read failure as an empty request and supports retry", async () => {
    read.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(rows);
    render(<PurchaseOrderLines orderId="po-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tải được");
    expect(screen.queryByText("Phiếu chưa có mặt hàng.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Đường cát")).toBeVisible();
  });
  it("ignores a late result from a previously opened request", async () => {
    let finish!: (value: typeof rows) => void;
    read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([{ ...rows[0], productName: "Trà", id: "tea" }]);
    const view = render(<PurchaseOrderLines orderId="old" />);
    view.rerender(<PurchaseOrderLines orderId="new" />);
    expect(await screen.findByText("Trà")).toBeVisible();
    finish(rows);
    await waitFor(() => expect(screen.queryByText("Đường cát")).not.toBeInTheDocument());
    expect(screen.getByText("Trà")).toBeVisible();
  });
});
