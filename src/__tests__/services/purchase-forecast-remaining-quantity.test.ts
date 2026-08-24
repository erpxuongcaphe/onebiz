import { describe, expect, it } from "vitest";
import {
  laHoaDonConDaXuatHopLe,
  tinhNhuCauMuaConLai,
} from "@/lib/services/supabase/purchase-forecast";

describe("Dự kiến mua hàng - số lượng còn phải xuất", () => {
  it("chỉ dùng số còn lại của từng SKU trong từng đơn gốc", () => {
    const rows = tinhNhuCauMuaConLai(
      [
        { orderId: "dh-a", productId: "sku-1", quantity: 10, total: 1000 },
        { orderId: "dh-a", productId: "sku-2", quantity: 3, total: 300 },
        { orderId: "dh-b", productId: "sku-1", quantity: 4, total: 400 },
      ],
      [
        { id: "hd-1", orderId: "dh-a", status: "completed" },
        { id: "hd-2", orderId: "dh-a", status: "completed" },
      ],
      [
        { childSaleId: "hd-1", productId: "sku-1", quantity: 2 },
        { childSaleId: "hd-2", productId: "sku-1", quantity: 3 },
        { childSaleId: "hd-2", productId: "sku-thu-ngan-ban-them", quantity: 1 },
      ],
    );

    expect(rows).toEqual([
      {
        orderId: "dh-a",
        productId: "sku-1",
        orderedQuantity: 10,
        issuedQuantity: 5,
        remainingQuantity: 5,
        remainingAmount: 500,
      },
      {
        orderId: "dh-a",
        productId: "sku-2",
        orderedQuantity: 3,
        issuedQuantity: 0,
        remainingQuantity: 3,
        remainingAmount: 300,
      },
      {
        orderId: "dh-b",
        productId: "sku-1",
        orderedQuantity: 4,
        issuedQuantity: 0,
        remainingQuantity: 4,
        remainingAmount: 400,
      },
    ]);
  });

  it("không để bán vượt hoặc hàng bán thêm tạo nhu cầu âm", () => {
    const [row] = tinhNhuCauMuaConLai(
      [{ orderId: "dh-a", productId: "sku-1", quantity: 2, total: 200 }],
      [{ id: "hd-1", orderId: "dh-a", status: "completed" }],
      [{ childSaleId: "hd-1", productId: "sku-1", quantity: 5 }],
    );

    expect(row).toMatchObject({
      orderedQuantity: 2,
      issuedQuantity: 5,
      remainingQuantity: 0,
      remainingAmount: 0,
    });
  });

  it("không trừ nhu cầu từ nháp, hóa đơn void, hủy hoặc đã xóa", () => {
    const sales = [
      { id: "draft", orderId: "dh-a", status: "draft" },
      { id: "void", orderId: "dh-a", status: "completed", voidedAt: "2026-08-24" },
      { id: "cancel", orderId: "dh-a", status: "completed", cancelledAt: "2026-08-24" },
      { id: "deleted", orderId: "dh-a", status: "completed", deletedAt: "2026-08-24" },
      { id: "valid", orderId: "dh-a", status: "completed" },
    ];
    expect(sales.map(laHoaDonConDaXuatHopLe)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);

    const [row] = tinhNhuCauMuaConLai(
      [{ orderId: "dh-a", productId: "sku-1", quantity: 10, total: 1000 }],
      sales,
      sales.map((sale) => ({
        childSaleId: sale.id,
        productId: "sku-1",
        quantity: 1,
      })),
    );
    expect(row).toMatchObject({ issuedQuantity: 1, remainingQuantity: 9 });
  });
});
