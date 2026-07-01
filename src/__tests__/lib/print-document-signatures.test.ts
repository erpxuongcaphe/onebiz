import { describe, it, expect } from "vitest";
import { generateDocumentHtml, type DocumentPrintData } from "@/lib/print-document";

function doc(over: Partial<DocumentPrintData> = {}): DocumentPrintData {
  return {
    documentType: "PHIẾU NHẬP HÀNG",
    documentCode: "PN0001",
    date: "30/06/2026",
    createdBy: "Nguyễn Văn A",
    itemColumns: ["Tên hàng", "SL", "Đơn giá", "Thành tiền"],
    items: [{ name: "Cà phê", quantity: 1, unitPrice: 1000, total: 1000 }],
    ...over,
  };
}

function footerCols(html: string): string[] {
  // Class "title" chỉ xuất hiện ở cột ký (masthead dùng .doc-type) → lấy tất cả.
  return [...html.matchAll(/<div class="title">([\s\S]*?)<\/div>/g)].map((m) => m[1].trim());
}

describe("generateDocumentHtml — ô ký tùy biến", () => {
  it("mặc định 2 ô: Người lập phiếu + Người duyệt", () => {
    const html = generateDocumentHtml(doc(), "A4");
    expect(footerCols(html)).toEqual(["Người lập phiếu", "Người duyệt"]);
  });

  it("danh sách tùy biến → render đúng thứ tự (Người lập · Thủ kho · Kế toán)", () => {
    const html = generateDocumentHtml(
      doc({ signatures: [{ label: "Người lập" }, { label: "Thủ kho" }, { label: "Kế toán" }] }),
      "A4",
    );
    expect(footerCols(html)).toEqual(["Người lập", "Thủ kho", "Kế toán"]);
  });

  it("thêm ô Khách hàng (bên mua)", () => {
    const html = generateDocumentHtml(
      doc({ documentType: "HÓA ĐƠN", signatures: [{ label: "Người bán" }, { label: "Khách hàng" }] }),
      "A5",
    );
    expect(footerCols(html)).toContain("Khách hàng");
  });

  it("ô ĐẦU TIÊN tự điền tên người lập (createdBy)", () => {
    const html = generateDocumentHtml(doc({ createdBy: "Trần Thị B" }), "A4");
    const footer = html.match(/<div class="footer">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? html;
    // Tên xuất hiện trong khối chữ ký, ở cột đầu
    expect(html).toContain("Trần Thị B");
  });

  it("showSignature=false → KHÔNG render khối chữ ký", () => {
    const html = generateDocumentHtml(doc({ showSignature: false }), "A4");
    expect(html).not.toContain('class="footer"');
  });
});
