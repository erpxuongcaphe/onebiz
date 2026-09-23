import { describe, expect, it } from "vitest";
import { cashCategoryLabel, cashPaymentMethodLabel } from "@/lib/utils/cash-book-labels";

describe("cash book labels shared by ledger and reports", () => {
  it("shows existing categories in Vietnamese without changing their codes", () => {
    expect(cashCategoryLabel("customer_payment")).toBe("Thu tiền khách hàng");
    expect(cashCategoryLabel("supplier_payment")).toBe("Chi trả NCC");
    expect(cashCategoryLabel("new_category")).toBe("new_category");
    expect(cashCategoryLabel(null)).toBe("—");
  });

  it("labels payment methods", () => {
    expect(cashPaymentMethodLabel("transfer")).toBe("Chuyển khoản");
    expect(cashPaymentMethodLabel("cash")).toBe("Tiền mặt");
  });
});
