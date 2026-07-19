import { describe, expect, it } from "vitest";
import {
  canOpenStockDocument,
  getStockDocumentKind,
  getStockDocumentLabel,
} from "@/lib/stock-document";

describe("stock document links", () => {
  it.each([
    ["invoice", "invoice"],
    ["bom_consume", "invoice"],
    ["invoice_void", "invoice"],
    ["purchase_order", "purchase_order"],
    ["purchase_order_revert", "purchase_order"],
    ["production_reconcile", "production_order"],
    ["inventory_check", "inventory_check"],
    ["disposal_export", "disposal_export"],
    ["return_bom_restore", "sales_return"],
    ["internal_sale", "internal_sale"],
    ["internal_export", "internal_export"],
    ["stock_transfer", "stock_transfer"],
    ["supplier_return", "supplier_return"],
    ["purchase_return", "supplier_return"],
    ["purchase_entry", "purchase_order"],
  ])("maps %s to %s", (referenceType, expectedKind) => {
    expect(getStockDocumentKind(referenceType)).toBe(expectedKind);
  });

  it("keeps manual and initial-stock rows read-only when no source document exists", () => {
    expect(getStockDocumentKind("initial_stock_import")).toBe("unsupported");
    expect(canOpenStockDocument("initial_stock_import", "source-id")).toBe(false);
    expect(canOpenStockDocument("invoice", undefined)).toBe(false);
  });

  it("uses the shared Vietnamese document labels", () => {
    expect(getStockDocumentLabel("invoice")).toBe("Hóa đơn");
    expect(getStockDocumentLabel("inventory_check")).toBe("Phiếu kiểm kho");
    expect(getStockDocumentLabel("unknown_reference")).toBe("Chứng từ kho");
  });
});
