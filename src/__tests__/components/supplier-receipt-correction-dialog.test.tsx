import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SupplierReceiptCorrectionDialog } from "@/components/shared/dialogs/supplier-receipt-correction-dialog";
import { correctSupplierReceiptLine, getPurchaseOrderItems } from "@/lib/services/supabase/purchase-orders";

vi.mock("@/lib/services/supabase/purchase-orders", () => ({
  correctSupplierReceiptLine: vi.fn(),
  getPurchaseOrderItems: vi.fn(),
}));

it("previews branch and lot quantities before applying a received purchase correction", async () => {
  vi.mocked(getPurchaseOrderItems).mockResolvedValue([{
    id: "item", productId: "sugar", productCode: "SKU-1", productName: "Đường cát", unit: "Kg",
    quantity: 10000, receivedQuantity: 10000, unitPrice: 22, remaining: 0, conversionFactor: 1,
    lineTotal: 220000, discount: 0, vatRate: 0, expiryDate: null, lotNumber: null,
  }]);
  const outcome = {
    oldQuantity: 10000, newQuantity: 10, oldUnitPrice: 22, newUnitPrice: 22000, stockUnit: "Kg",
    stockBefore: 9994.525, stockAfter: 4.525, lotBefore: 9994.525, lotAfter: 4.525, oldValue: 249964, newValue: 102188,
    oldTotal: 220000, newTotal: 220000, oldDebt: 220000, newDebt: 220000, paid: 0, usedCostDelta: 147777,
  };
  vi.mocked(correctSupplierReceiptLine)
    .mockResolvedValueOnce({ ...outcome, token: "preview-token" })
    .mockResolvedValueOnce({ ...outcome, applied: true });
  const onDone = vi.fn();
  render(<SupplierReceiptCorrectionDialog order={{ id: "po", code: "PO000520" }} onClose={vi.fn()} onDone={onDone} />);

  fireEvent.change(await screen.findByLabelText("Số thực nhận (Kg)"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Đơn giá (đ/Kg)"), { target: { value: "22000" } });
  fireEvent.change(screen.getByLabelText("Lý do điều chỉnh"), { target: { value: "Sai quy đổi" } });
  fireEvent.click(screen.getByRole("button", { name: "Xem trước chênh lệch" }));
  expect(await screen.findByText("Tồn chi nhánh")).toBeInTheDocument();
  expect(screen.getByText("Tồn lô")).toBeInTheDocument();
  expect(correctSupplierReceiptLine).toHaveBeenCalledWith("po", "item", 10, 22000, "Sai quy đổi", undefined);
  expect(onDone).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Xác nhận điều chỉnh" }));
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(correctSupplierReceiptLine).toHaveBeenLastCalledWith("po", "item", 10, 22000, "Sai quy đổi", "preview-token");
});
