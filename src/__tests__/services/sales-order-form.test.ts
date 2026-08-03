import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getSalesOrderSaveErrorMessage,
  normalizeSalesOrderReceiver,
  validateSalesOrderDraft,
} from "@/lib/sales-order-form";

const dialogSource = readFileSync(
  "src/components/shared/dialogs/create-order-dialog.tsx",
  "utf8",
);

describe("sales-order form validation", () => {
  it("wires customer address and client validation into the order dialog", () => {
    expect(dialogSource).toContain('.select("id, name, phone, address")');
    expect(dialogSource).toContain("if (c.phone.trim() && c.address.trim())");
    expect(dialogSource).toContain("validateSalesOrderDraft({");
    expect(dialogSource).toContain("getSalesOrderSaveErrorMessage(err)");
  });
  it("distinguishes empty, partial and complete receiver details", () => {
    expect(normalizeSalesOrderReceiver("", "", "").isEmpty).toBe(true);
    expect(normalizeSalesOrderReceiver("An", "", "").isPartial).toBe(true);
    expect(normalizeSalesOrderReceiver(" An ", " 0909 ", " HCM ")).toMatchObject({
      name: "An",
      phone: "0909",
      address: "HCM",
      isComplete: true,
    });
  });

  it("blocks incomplete shipping details before calling the RPC", () => {
    const errors = validateSalesOrderDraft({
      items: [{ quantity: 1, price: 100_000 }],
      deliveryFee: 0,
      receiver: normalizeSalesOrderReceiver("Khách A", "0909", ""),
    });
    expect(errors.receiver).toContain("Điền đủ");
  });

  it("accepts an ordinary order without a shipment", () => {
    expect(
      validateSalesOrderDraft({
        items: [{ quantity: 1, price: 100_000 }],
        deliveryFee: 0,
        receiver: normalizeSalesOrderReceiver("", "", ""),
      }),
    ).toEqual({});
  });

  it("validates quantity, price and delivery fee", () => {
    expect(
      validateSalesOrderDraft({
        items: [{ quantity: 0, price: 100_000 }],
        deliveryFee: -1,
        receiver: normalizeSalesOrderReceiver("", "", ""),
      }),
    ).toMatchObject({ items: expect.any(String), shippingFee: expect.any(String) });
  });

  it("translates database rule codes into clear Vietnamese", () => {
    expect(
      getSalesOrderSaveErrorMessage(
        new Error("[saveSalesOrderAtomic] SHIPMENT_RECEIVER_INCOMPLETE (22023)"),
      ),
    ).toContain("Thông tin giao hàng chưa đủ");
  });
});
