import { describe, expect, it } from "vitest";
import {
  cashCategoryLabel,
  cashOperationLabel,
  cashPaymentSplit,
  cashNoteSummary,
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
    ).toBe("Thanh toán NCC");
    expect(
      cashOperationLabel({
        category: "supplier_payment",
        referenceType: "purchase_order",
        advanceOriginal: 100,
      }),
    ).toBe("Thanh toán NCC");
    expect(
      cashPaymentSplit({
        category: "supplier_payment",
        referenceType: "purchase_order",
        amount: 6291006,
        advanceOriginal: 1397006,
      }),
    ).toEqual({ documentAmount: 4894000, advanceAmount: 1397006 });
  });
  it("keeps aliases consistent and does not guess business meaning from notes", () => {
    expect(cashCategoryLabel("Trả nhà cung cấp")).toBe("Thanh toán NCC");
    expect(cashCategoryLabel("supplier_advance_refund")).toBe("NCC hoàn ứng");
    expect(cashCategoryLabel("customer_advance_refund")).toBe("Hoàn ứng khách");
    expect(
      cashPaymentSplit({
        category: "other",
        referenceType: "purchase_order",
        amount: 100,
        advanceOriginal: 20,
      }),
    ).toBeNull();
    expect(
      cashPaymentSplit({
        category: "supplier_payment",
        referenceType: "purchase_order",
        amount: 100,
        advanceOriginal: 120,
      }),
    ).toBeNull();
  });
  it("shortens exact generated suffixes without changing the original or cancellation reason", () => {
    const note = "Trả nợ tổng NCC Trung Kiên — PO PO000406 [HỦY] xóa do chi dư";
    expect(
      cashNoteSummary(
        {
          note,
          status: "cancelled",
          referenceType: "purchase_order",
          referenceCode: "PO000406",
        },
        "Trung Kiên",
      ),
    ).toEqual({
      summary: "Thanh toán tiền hàng",
      original: note,
      cancellationReason: "xóa do chi dư",
      shortened: true,
    });
    expect(
      cashNoteSummary(
        {
          note: "Thanh toán chuyển khoản 10/10 — phân bổ PO PO000394",
          referenceType: "purchase_order",
          referenceCode: "PO000394",
        },
        "Trung Kiên",
      ).summary,
    ).toBe("Thanh toán chuyển khoản 10/10");
  });
  it("preserves arbitrary notes and mismatched source codes exactly", () => {
    const note = "Khách yêu cầu giữ dòng — PO PO999; hẹn đối soát vào 20/10";
    expect(
      cashNoteSummary(
        { note, referenceType: "purchase_order", referenceCode: "PO000406" },
        "Trung Kiên",
      ),
    ).toMatchObject({ summary: note, original: note, shortened: false });
    expect(
      cashNoteSummary(
        { note: "NCC hoàn dư · PC000267", refundSourceCode: "PC000267" },
        "Trung Kiên",
      ).summary,
    ).toBe("NCC hoàn dư");
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
