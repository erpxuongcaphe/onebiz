import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reconcileInvoiceTotal } from "@/lib/utils/invoice-reconciliation";

const invoicePage = readFileSync(
  resolve(process.cwd(), "src/app/(main)/don-hang/hoa-don/page.tsx"),
  "utf8",
);

describe("reconcileInvoiceTotal", () => {
  it("recognizes mixed line VAT as part of the invoice total", () => {
    expect(
      reconcileInvoiceTotal({
        subtotal: 2_430_000,
        lineDiscount: 0,
        totalDiscount: 0,
        itemTaxAmount: 238_400,
        reportedTaxAmount: 238_400,
        deliveryFee: 0,
        invoiceTotal: 2_668_400,
      }),
    ).toEqual({
      orderDiscount: 0,
      taxAmount: 238_400,
      expectedTotal: 2_668_400,
      difference: 0,
      hasDifference: false,
    });
  });

  it("detects a historical header total that duplicated one item", () => {
    const result = reconcileInvoiceTotal({
      subtotal: 7_030_000,
      lineDiscount: 0,
      totalDiscount: 0,
      itemTaxAmount: 0,
      reportedTaxAmount: 1_080_000,
      deliveryFee: 0,
      invoiceTotal: 8_110_000,
    });

    expect(result.expectedTotal).toBe(7_030_000);
    expect(result.difference).toBe(1_080_000);
    expect(result.hasDifference).toBe(true);
  });

  it("accepts a supported order-level VAT rate", () => {
    const result = reconcileInvoiceTotal({
      subtotal: 1_000_000,
      lineDiscount: 0,
      totalDiscount: 0,
      itemTaxAmount: 0,
      reportedTaxAmount: 80_000,
      deliveryFee: 0,
      invoiceTotal: 1_080_000,
    });

    expect(result.taxAmount).toBe(80_000);
    expect(result.difference).toBe(0);
    expect(result.hasDifference).toBe(false);
  });

  it("does not subtract line discounts twice from the order discount", () => {
    expect(
      reconcileInvoiceTotal({
        subtotal: 1_000_000,
        lineDiscount: 50_000,
        totalDiscount: 150_000,
        itemTaxAmount: 80_000,
        reportedTaxAmount: 80_000,
        deliveryFee: 20_000,
        invoiceTotal: 950_000,
      }),
    ).toEqual({
      orderDiscount: 100_000,
      taxAmount: 80_000,
      expectedTotal: 950_000,
      difference: 0,
      hasDifference: false,
    });
  });

  it("keeps VAT and historical differences visible in invoice details", () => {
    expect(invoicePage).toContain('label: "VAT"');
    expect(invoicePage).toContain('label: "Chênh lệch dữ liệu"');
    expect(invoicePage).toContain(
      "value: formatCurrency(reconciliation.orderDiscount)",
    );
  });
});
