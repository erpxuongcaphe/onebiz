import { describe, expect, it } from "vitest";
import { generateDocumentHtml, type DocumentPrintData } from "@/lib/print-document";

const sample: DocumentPrintData = {
  documentType: "DỮ LIỆU IN THỬ", documentCode: "TEST-ONEBIZ", date: "2026-10-08T03:00:00Z",
  items: [{ name: "Cà phê sữa đá", quantity: 2, unitPrice: 35000, total: 70000, note: "Đường 70% • ít đá" }],
  summaryRows: [{ label: "Tổng thử", value: "70.000 đ", bold: true }], showSignature: false,
};
describe("F&B readable thermal documents", () => {
  it.each(["58mm", "80mm"] as const)("keeps item details and totals on %s with compact spacing", paper => {
    const html = generateDocumentHtml({ ...sample, fnbThermalReadable: true }, paper);
    expect(html).toContain("Cà phê sữa đá");
    expect(html).toContain("Đường 70%");
    expect(html).toContain("70.000 đ");
    expect(html).toContain("font-size: 14px; color: #000;");
    expect(html).toContain("padding: 1px 0");
  });
  it.each(["A4", "A5"] as const)("does not change %s documents", paper => {
    expect(generateDocumentHtml({ ...sample, fnbThermalReadable: true }, paper)).toBe(generateDocumentHtml(sample, paper));
  });
});
