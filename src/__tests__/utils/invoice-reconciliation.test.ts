import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getInvoiceItemTaxAmount,
  inferLegacyMixedTaxAmount,
  reconcileInvoiceTotal,
} from "@/lib/utils/invoice-reconciliation";

const invoicePage = readFileSync(
  resolve(process.cwd(), "src/app/(main)/don-hang/hoa-don/page.tsx"),
  "utf8",
);
const invoiceService = readFileSync(
  resolve(process.cwd(), "src/lib/services/supabase/invoices.ts"),
  "utf8",
);

describe("reconcileInvoiceTotal", () => {
  it("rebuilds missing legacy line VAT from the stored rate", () => {
    expect(
      getInvoiceItemTaxAmount({
        quantity: 10,
        unitPrice: 220_000,
        discount: 0,
        vatRate: 10,
        vatAmount: 0,
      }),
    ).toBe(220_000);
    expect(
      getInvoiceItemTaxAmount({
        quantity: 1,
        unitPrice: 230_000,
        discount: 0,
        vatRate: 8,
        vatAmount: 0,
      }),
    ).toBe(18_400);
  });

  it("prefers the persisted line VAT amount when available", () => {
    expect(
      getInvoiceItemTaxAmount({
        quantity: 1,
        unitPrice: 100_000,
        discount: 0,
        vatRate: 10,
        vatAmount: 9_500,
      }),
    ).toBe(9_500);
  });

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

  it("accepts inferred legacy VAT only when it exactly explains the header", () => {
    expect(
      reconcileInvoiceTotal({
        subtotal: 2_430_000,
        lineDiscount: 0,
        totalDiscount: 0,
        itemTaxAmount: 0,
        inferredItemTaxAmount: 238_400,
        reportedTaxAmount: 0,
        deliveryFee: 0,
        invoiceTotal: 2_668_400,
      }),
    ).toMatchObject({
      taxAmount: 238_400,
      difference: 0,
      hasDifference: false,
    });
  });

  it("reconstructs the exact mixed 10% and 8% VAT of HD001213", () => {
    expect(
      inferLegacyMixedTaxAmount(
        [
          {
            quantity: 10,
            unitPrice: 220_000,
            discount: 0,
            vatRate: 0,
            vatAmount: 0,
          },
          {
            quantity: 1,
            unitPrice: 230_000,
            discount: 0,
            vatRate: 0,
            vatAmount: 0,
          },
        ],
        238_400,
      ),
    ).toBe(238_400);
  });

  it("does not turn the duplicated HD001494 item into legacy VAT", () => {
    expect(
      inferLegacyMixedTaxAmount(
        [
          {
            quantity: 20,
            unitPrice: 240_000,
            discount: 0,
            vatRate: 0,
            vatAmount: 0,
          },
          {
            quantity: 5,
            unitPrice: 230_000,
            discount: 0,
            vatRate: 0,
            vatAmount: 0,
          },
          {
            quantity: 1,
            unitPrice: 1_080_000,
            discount: 0,
            vatRate: 0,
            vatAmount: 0,
          },
        ],
        1_080_000,
      ),
    ).toBe(0);
  });

  it("does not relabel an unrelated historical difference as inferred VAT", () => {
    expect(
      reconcileInvoiceTotal({
        subtotal: 7_030_000,
        lineDiscount: 0,
        totalDiscount: 0,
        itemTaxAmount: 0,
        inferredItemTaxAmount: 703_000,
        reportedTaxAmount: 0,
        deliveryFee: 0,
        invoiceTotal: 8_110_000,
      }),
    ).toMatchObject({
      taxAmount: 0,
      difference: 1_080_000,
      hasDifference: true,
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

  it("falls back to the product VAT rate for legacy invoice items", () => {
    expect(invoiceService).toContain(
      "products!invoice_items_product_id_fkey(code, vat_rate)",
    );
    expect(invoiceService).toContain("row.products?.vat_rate ?? 0");
  });
});
