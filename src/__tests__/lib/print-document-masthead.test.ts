import { describe, it, expect } from "vitest";
import { generateDocumentHtml, type DocumentPrintData } from "@/lib/print-document";

function doc(over: Partial<DocumentPrintData> = {}): DocumentPrintData {
  return {
    documentType: "HÓA ĐƠN THANH TOÁN",
    documentCode: "HD001328",
    date: "27/06/2026",
    businessAddress: "A9 đường N4, Trấn Biên, Đồng Nai",
    businessPhone: "0792882484",
    branchName: "Xưởng Cà Phê - Kho Tổng",
    itemColumns: ["Tên hàng", "SL", "Đơn giá", "Thành tiền"],
    items: [{ name: "Chai rửa tay Kleen", quantity: 1, unit: "Chai", unitPrice: 40000, total: 40000 }],
    ...over,
  };
}

describe("generateDocumentHtml — đầu phiếu chuyên nghiệp (A4/A5)", () => {
  it("tiêu đề nằm trong khối doc-title-band + đứng TRƯỚC khối đơn vị (lên đầu)", () => {
    const html = generateDocumentHtml(doc(), "A5");
    expect(html).toContain('class="doc-title-band"');
    expect(html).toContain('class="seller-band"');
    const iTitle = html.indexOf('class="doc-title-band"');
    const iSeller = html.indexOf('class="seller-band"');
    expect(iTitle).toBeGreaterThan(-1);
    expect(iSeller).toBeGreaterThan(iTitle); // tiêu đề TRƯỚC đơn vị = lên đầu
  });

  it("tiêu đề + Số/Ngày nằm trong band trên cùng", () => {
    const html = generateDocumentHtml(doc(), "A5");
    const band = html.match(/<div class="doc-title-band">([\s\S]*?)<\/div>\s*<div class="seller-band">/)?.[1] ?? "";
    expect(band).toContain("HÓA ĐƠN THANH TOÁN");
    expect(band).toContain("HD001328");
    expect(band).toContain("Số:");
    expect(band).toContain("Ngày:");
  });

  it("hiện tên chi nhánh khi có branchName", () => {
    const html = generateDocumentHtml(doc(), "A5");
    expect(html).toContain("Chi nhánh: Xưởng Cà Phê - Kho Tổng");
  });

  it("thermal 80mm KHÔNG dùng doc-title-band (giữ head-c)", () => {
    const html = generateDocumentHtml(doc(), "80mm");
    expect(html).not.toContain('class="doc-title-band"');
    expect(html).toContain('class="head-c"');
  });
});
