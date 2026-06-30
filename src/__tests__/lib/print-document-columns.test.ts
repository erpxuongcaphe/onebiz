import { describe, it, expect } from "vitest";
import { generateDocumentHtml, type DocumentPrintData } from "@/lib/print-document";

/** Đếm số <th> trong thead + số <td> của từng <tr> trong tbody. */
function countCols(html: string) {
  const thead = html.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? "";
  const thCount = (thead.match(/<th/g) ?? []).length;
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const rows = tbody.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const tdPerRow = rows.map((r) => (r.match(/<td/g) ?? []).length);
  return { thCount, tdPerRow };
}

function baseDoc(over: Partial<DocumentPrintData> = {}): DocumentPrintData {
  return {
    documentType: "HOÁ ĐƠN BÁN HÀNG",
    documentCode: "HD001328",
    date: "27/06/2026",
    itemColumns: ["Tên hàng", "SL", "Đơn giá", "Giảm giá", "Thành tiền"],
    items: [
      { name: "Chai rửa tay Kleen", quantity: 1, unit: "Chai", unitPrice: 40000, discount: 0, total: 40000 },
    ],
    ...over,
  };
}

describe("generateDocumentHtml — cột bảng mặt hàng KHÔNG lệch", () => {
  it("có cột Giảm giá + dòng giảm 0 → số ô dòng = số ô header (bug HD001328)", () => {
    const html = generateDocumentHtml(baseDoc(), "A4");
    const { thCount, tdPerRow } = countCols(html);
    expect(thCount).toBe(6); // STT + 5 cột
    expect(tdPerRow).toEqual([6]); // dòng phải đủ 6 ô, KHÔNG thiếu ô Giảm giá
  });

  it("dòng có giảm giá > 0 → vẫn đủ ô + đúng số", () => {
    const html = generateDocumentHtml(
      baseDoc({ items: [{ name: "A", quantity: 2, unitPrice: 50000, discount: 5000, total: 95000 }] }),
      "A4",
    );
    const { thCount, tdPerRow } = countCols(html);
    expect(thCount).toBe(6);
    expect(tdPerRow).toEqual([6]);
  });

  it("mặc định (không itemColumns) → header và dòng vẫn khớp", () => {
    const html = generateDocumentHtml(
      baseDoc({ itemColumns: undefined, items: [{ name: "A", code: "SP01", quantity: 1, unitPrice: 1000, total: 1000 }] }),
      "A4",
    );
    const { thCount, tdPerRow } = countCols(html);
    expect(tdPerRow.every((n) => n === thCount)).toBe(true);
  });

  it("nhiều dòng, giảm 0 lẫn giảm >0 → mọi dòng đều khớp header", () => {
    const html = generateDocumentHtml(
      baseDoc({
        items: [
          { name: "A", quantity: 1, unitPrice: 40000, discount: 0, total: 40000 },
          { name: "B", quantity: 3, unitPrice: 10000, discount: 2000, total: 28000 },
        ],
      }),
      "A4",
    );
    const { thCount, tdPerRow } = countCols(html);
    expect(tdPerRow.every((n) => n === thCount)).toBe(true);
  });
});
