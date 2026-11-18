import { describe, expect, it, vi } from "vitest";
import { buildInvoicePrintData } from "@/lib/print-templates";
import { applyTemplateToDocData } from "@/lib/print-apply-template";
import { generateDocumentHtml } from "@/lib/print-document";

vi.mock("@/lib/services", () => ({ resolvePrintTemplate: vi.fn(), getResolvedBrand: vi.fn() }));

describe("warehouse saved-template printing", () => {
  it.each(["A4", "A5"] as const)("HD009982 keeps zero balance and separate units on %s", (paperSize) => {
    const base = buildInvoicePrintData({
      id: "fixture", code: "HD009982", date: "18/11/2026", customerId: "",
      customerCode: "", customerName: "Khách hàng", createdBy: "",
      totalAmount: 0, discount: 230000, shippingFee: 0, taxAmount: 0,
      paid: 0, debt: 0, status: "completed", deliveryType: "no_delivery", source: "pos",
    }, undefined, [{ name: "WS - Xưởng Gu Việt - 1000gram/túi", quantity: 1, unit: "Kg", unitPrice: 230000, total: 0 }]);
    // Existing template configuration which previously dropped the unit column.
    const printed = applyTemplateToDocData(base, {
      config: { items: { columns: ["name", "quantity", "price", "total"] } }, brand: {},
    });
    expect(printed.itemColumns).toEqual(["Tên hàng", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền", "Ghi chú"]);
    const html = generateDocumentHtml(printed, paperSize);
    expect(html).toContain('<td class="center">Kg</td>');
    expect(html).toContain('<td class="right tnum">1</td>');
    expect(html).not.toContain('<span class="unit">');
    expect(html).not.toContain("-230,000");
    expect(html).not.toContain("Tiền thối lại");
    expect(printed.summaryRows).toContainEqual(expect.objectContaining({ label: "Tổng cộng", value: "0 đ" }));
    const head = html.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? "";
    const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
    expect((head.match(/<th\s/g) ?? []).length).toBe(7);
    expect((body.match(/<td[\s>]/g) ?? []).length).toBe(7);
  });
});
