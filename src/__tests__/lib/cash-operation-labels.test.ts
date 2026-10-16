import { describe, expect, it } from "vitest";
import {
  cashCategoryLabel,
  cashOperationLabel,
} from "@/lib/utils/cash-book-labels";

describe("consistent cash business classification", () => {
  it("names standalone customer and supplier advances identically everywhere", () => {
    for (const category of ["supplier_advance", "customer_advance"]) {
      expect(cashOperationLabel({ category })).toBe(
        cashCategoryLabel(category),
      );
    }
    expect(cashCategoryLabel("supplier_advance")).toBe("Ứng trước NCC");
    expect(cashCategoryLabel("customer_advance")).toBe("Khách trả trước");
  });
  it("distinguishes purchase payment from its excess advance", () => {
    expect(
      cashOperationLabel({
        category: "purchase",
        referenceType: "purchase_order",
      }),
    ).toBe("Trả tiền nhập hàng");
    expect(
      cashOperationLabel({
        category: "supplier_payment",
        referenceType: "purchase_order",
        advanceOriginal: 100,
      }),
    ).toBe("Trả tiền nhập hàng và ứng trước NCC");
  });
  it("does not classify a refund or unknown historical category as a new purchase", () => {
    expect(
      cashOperationLabel({
        category: "invoice_void",
        referenceType: "invoice",
      }),
    ).toBe("Hoàn tiền hủy hóa đơn");
    expect(cashOperationLabel({ category: "Khoản mục cũ" })).toBe(
      "Khoản mục cũ",
    );
  });
});
