import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitBillDialog } from "@/app/pos/fnb/components/split-bill-dialog";
import { splitBillFailure } from "@/lib/fnb/split-error";

const items = [
  { id: "one", name: "Coffee", quantity: 1, unitPrice: 30_000 },
  { id: "two", name: "Tea", quantity: 1, unitPrice: 20_000 },
];

function setup(byItems = vi.fn().mockResolvedValue(true), equally = vi.fn().mockResolvedValue(true)) {
  const onOpenChange = vi.fn();
  render(<SplitBillDialog open onOpenChange={onOpenChange} items={items} onSplitByItems={byItems} onSplitEqually={equally} />);
  return { byItems, equally, onOpenChange };
}

describe("F&B split result", () => {
  it.each(["items", "equal"])("shows the confirmed business reason in %s mode", async (mode) => {
    const rejected=vi.fn().mockRejectedValue(splitBillFailure({message:"DELIVERY_ORDER_CANNOT_SPLIT",code:"22023"}));
    const {onOpenChange}=setup(rejected,rejected);
    if(mode==="equal") {
      fireEvent.click(screen.getByRole("button",{name:"Chia nhiều bill"}));
      fireEvent.click(screen.getByRole("button",{name:"Chia 2 phần"}));
    } else {
      fireEvent.click(screen.getAllByRole("checkbox")[0]);
      fireEvent.click(screen.getByRole("button",{name:"Tách 1 món"}));
    }
    expect(await screen.findByRole("alert")).toHaveTextContent("Đơn qua đối tác");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Chưa xác nhận");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
  it("preserves selection and dialog when server does not confirm success", async () => {
    const { byItems, onOpenChange } = setup(vi.fn().mockResolvedValue(false));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Tách 1 món" }));
    await screen.findByRole("alert");
    expect(byItems).toHaveBeenCalledWith([{ itemId: "one", quantity: 1, expectedQuantity: 1 }], expect.any(String));
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("handles rejected requests without closing or leaving controls locked", async () => {
    const { onOpenChange } = setup(vi.fn().mockRejectedValue(new Error("offline")));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Tách 1 món" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Tách 1 món" })).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not allow cancellation or duplicate submission while request is pending", async () => {
    let finish!: (ok: boolean) => void;
    const { byItems, onOpenChange } = setup(vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; })));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Tách 1 món" }));
    expect(screen.getByRole("button", { name: "Hủy" })).toBeDisabled();
    expect(screen.getAllByRole("checkbox")[0]).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(screen.getByRole("dialog", { name: "Có nội dung chưa lưu" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục chỉnh sửa" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Có nội dung chưa lưu" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Tách 1 món" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(byItems).toHaveBeenCalledTimes(1);
    await act(async () => finish(true));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("rejects fractional and out-of-range equal splits", () => {
    const { equally } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Chia nhiều bill" }));
    for (const value of ["1", "2.5", "11"]) {
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value } });
      expect(screen.getByRole("button", { name: `Chia ${value} phần` })).toBeDisabled();
    }
    expect(equally).not.toHaveBeenCalled();
  });

  it("closes only after a successful equal split", async () => {
    const { equally, onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Chia nhiều bill" }));
    fireEvent.click(screen.getByRole("button", { name: "Chia 2 phần" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(equally).toHaveBeenCalledWith(2);
  });
});
