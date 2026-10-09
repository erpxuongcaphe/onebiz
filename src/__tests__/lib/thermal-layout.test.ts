import { describe, expect, it } from "vitest";
import { generateDocumentHtml, type DocumentPrintData } from "@/lib/print-document";
import { applyTemplateToDocData } from "@/lib/print-apply-template";
import { applyKitchenTemplate } from "@/lib/kitchen-print-template";
import { buildKitchenTicketHtml, buildFnbReceiptHtml, type KitchenTicketDataV2, type FnbReceiptData } from "@/lib/print-fnb";
import { resolveThermalLayout } from "@/lib/thermal-layout";
import type { ThermalLayoutConfig } from "@/lib/thermal-layout";

const bill: DocumentPrintData = {
  documentType: "HÓA ĐƠN", documentCode: "HD1", date: "2026-10-08T03:00:00Z",
  fnbThermalReadable: true, showSignature: false,
  items: [{ name: "Cà phê có tên dài & topping", quantity: 2, unitPrice: 35000, total: 70000, note: "Ít đá" }],
  summaryRows: [{ label: "Tạm tính", value: "70.000 đ" }, { label: "Tổng cộng", value: "70.000 đ", bold: true }],
};
const ticket: KitchenTicketDataV2 = {
  orderNumber: "KB1", tableName: "Bàn 9", orderType: "dine_in", createdAt: bill.date,
  items: [{ name: "Cà phê", quantity: 2, unitPrice: 35000, variant: "L", modifierLabels: ["Đường 50%"], note: "Dị ứng sữa", toppings: [{ name: "Kem", quantity: 1, price: 5000 }] }],
};
describe("compact F&B thermal layout", () => {
  it.each(["58mm", "80mm"] as const)("keeps editable cutter clearance and normal italic details across all %s paths", paper => {
    const fallback: FnbReceiptData = { ...ticket, paperSize: paper, invoiceCode: "HD1", subtotal: 70000, discountAmount: 0, deliveryFee: 0, total: 70000, paid: 70000, change: 0, paymentMethod: "cash" };
    const builders = [
      (thermalLayout?: ThermalLayoutConfig) => buildKitchenTicketHtml({ ...ticket, paperSize: paper, thermalLayout }),
      (thermalLayout?: ThermalLayoutConfig) => generateDocumentHtml({ ...bill, thermalLayout }, paper),
      (thermalLayout?: ThermalLayoutConfig) => buildFnbReceiptHtml({ ...fallback, thermalLayout }),
    ];
    for (const build of builders) {
      const html = build();
      expect(html).toContain("padding-top:1mm;padding-bottom:12mm");
      expect(html).toContain("font-weight:400");
      expect(html).toContain("font-style:italic");
      expect(html).toContain("margin:1mm 0;clear:both");
      expect(html).toContain("font-weight:400;line-height:1.25");
      const custom = build({ topMarginMm: 0, bottomMarginMm: 8, italicDetails: false, boldDetails: true });
      expect(custom).toContain("padding-top:0mm;padding-bottom:8mm");
      expect(custom).toContain("font-weight:700");
      expect(custom).toContain("font-style:normal");
    }
  });
  it("keeps long kitchen instructions normal and italic, including a variant inside a bold name", () => {
    const html = buildKitchenTicketHtml(ticket);
    expect(html).toContain('.qty{font-size:inherit;font-weight:inherit}');
    expect(html).not.toContain('.modifier{font-size:16px;font-weight:bold');
    expect(html).not.toContain('.note{font-size:16px;font-weight:bold');
    expect(html).toContain('.modifier,.note,.toppings,.variant{font-size:16px;color:#000;font-weight:400;font-style:italic');
  });
  it("rejects invalid margins without changing existing explicit typography choices", () => {
    expect(resolveThermalLayout({ topMarginMm: NaN, bottomMarginMm: Infinity, italicDetails: false })).toMatchObject({ topMarginMm: 1, bottomMarginMm: 12, italicDetails: false });
    expect(resolveThermalLayout({ topMarginMm: -20, bottomMarginMm: 999 })).toMatchObject({ topMarginMm: 0, bottomMarginMm: 25 });
  });
  it.each(["58mm", "80mm"] as const)("keeps quantity, money and notes while removing repeated subtotal on %s", paper => {
    const doc = new DOMParser().parseFromString(generateDocumentHtml(bill, paper), "text/html");
    expect(doc.querySelector(".compact-row")?.textContent).toContain("×2");
    expect(doc.querySelector(".compact-row")?.textContent).toContain("70,000");
    expect(doc.body.textContent).toContain("Ít đá");
    expect(doc.querySelector(".summary")?.textContent).not.toContain("Tạm tính");
    expect(doc.querySelectorAll(".footer")).toHaveLength(0);
    expect(doc.querySelector("style")?.textContent).toContain("overflow-wrap:anywhere");
  });
  it("keeps subtotal when discounts change the final amount", () => {
    const html = generateDocumentHtml({ ...bill, summaryRows: [{ label: "Tạm tính", value: "70.000 đ" }, { label: "Giảm giá", value: "10.000 đ" }, { label: "Tổng cộng", value: "60.000 đ", bold: true }] }, "80mm");
    expect(html).toContain("Tạm tính"); expect(html).toContain("10.000 đ"); expect(html).toContain("60.000 đ");
  });
  it("applies saved font sizes and separator settings to the rendered bill", () => {
    const data = applyTemplateToDocData(bill, { config: { thermal: { itemSize: 20, totalSize: 24, font: "mono", separator: "solid", italicDetails: true } }, brand: {} });
    const html = generateDocumentHtml(data, "80mm");
    for (const css of ["font-size: 20px", "font-size: 24px", "'Courier New'", "1px solid #000", "font-style:italic"]) expect(html).toContain(css);
  });
  it("never hides kitchen preparation instructions when bill notes are disabled", () => {
    const html = buildKitchenTicketHtml(applyKitchenTemplate(ticket, { thermal: { showItemNotes: false } }, "58mm"));
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const text of ["Bàn 9", "Cà phê", "Đường 50%", "Dị ứng sữa", "Kem"]) expect(doc.body.textContent).toContain(text);
    expect(doc.querySelectorAll(".time")).toHaveLength(0);
  });
  it("clamps corrupted style values and escapes product text", () => {
    const thermal = { itemSize: 9999, detailSize: -4, font: "x;display:none", separator: "solid;display:none" } as unknown as ThermalLayoutConfig;
    const html = generateDocumentHtml({ ...bill, thermalLayout: thermal, items: [{ ...bill.items![0], name: "<script>bad()</script>" }] }, "80mm");
    expect(html).not.toContain("display:none"); expect(html).toContain("font-size: 24px"); expect(html).toContain("font-size: 11px");
    expect(new DOMParser().parseFromString(html, "text/html").querySelector("script")).toBeNull();
  });
});
