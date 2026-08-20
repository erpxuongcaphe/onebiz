import { describe, expect, it } from "vitest";
import { generateDocumentHtml, type DocumentPrintData } from "@/lib/print-document";

/**
 * CEO 20/08/2026 — trình bày chứng từ in:
 *   1. Tiêu đề cột CĂN GIỮA (ô dữ liệu vẫn số phải / chữ trái).
 *   2. KHÔNG viết tắt "SL" — ghi rõ "Số lượng".
 *   3. Bỏ ký hiệu "đ" ở từng ô cho đỡ chật.
 *   4. Nêu "Đơn vị tính: Đồng" một lần phía trên bảng.
 * Riêng BILL NHIỆT giữ nguyên "đ" (khổ hẹp, không có chỗ đặt dòng đơn vị tính).
 *
 * Dựng HTML bằng ĐÚNG hàm in thật, không quét mã nguồn.
 */

const PHIEU: DocumentPrintData = {
  documentType: "HÓA ĐƠN THANH TOÁN",
  documentCode: "HD-TEST-001",
  date: "2026-08-17T06:12:00.000Z",
  headerFields: [{ label: "Khách hàng", value: "Xưởng Bửu Hòa" }],
  itemColumns: ["Tên hàng", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền"],
  items: [
    { name: "Xưởng Gu Việt - 1 kg/túi", quantity: 7, unit: "Kg", unitPrice: 237_600, total: 1_663_200 },
    { name: "Hồng Trà Toàn Phát", quantity: 2, unit: "Túi", unitPrice: 135_000, total: 270_000 },
  ],
  summaryRows: [
    { label: "Tổng tiền hàng", value: "2,632,080 đ" },
    { label: "Tổng cộng", value: "2,632,080 đ", bold: true },
    { label: "Còn nợ", value: "3,812,080 đ", tone: "danger" },
  ],
};

describe("Chứng từ A4 — tiêu đề căn giữa, không viết tắt, có đơn vị tính", () => {
  const html = generateDocumentHtml(PHIEU, "A4");

  /** Chỉ lấy BẢNG HÀNG (trang còn có bảng thông tin đầu phiếu + bảng tổng). */
  const bangHang = () => {
    const i = html.indexOf('<table class="items">');
    return html.slice(i, html.indexOf("</table>", i));
  };

  it("MỌI tiêu đề cột đều căn giữa", () => {
    const t = bangHang();
    const thead = t.slice(t.indexOf("<thead>"), t.indexOf("</thead>"));
    // (?=[\s>]) để KHÔNG khớp nhầm chính thẻ <thead>
    const ths = thead.match(/<th(?=[\s>])[^>]*>/g) ?? [];
    expect(ths.length).toBeGreaterThanOrEqual(5);
    for (const th of ths) expect(th).toContain('class="center"');
    // không còn tiêu đề căn phải
    expect(thead).not.toContain('<th class="right">');
  });

  it("ghi RÕ 'Số lượng', không có nhãn viết tắt 'SL'", () => {
    const t = bangHang();
    const thead = t.slice(t.indexOf("<thead>"), t.indexOf("</thead>"));
    expect(thead).toContain("Số lượng");
    expect(thead).not.toMatch(/>SL</);
  });

  it("có dòng 'Đơn vị tiền tệ: Đồng' ngay trên bảng", () => {
    expect(html).toContain("Đơn vị tiền tệ: Đồng");
    expect(html.indexOf("Đơn vị tiền tệ: Đồng")).toBeLessThan(
      html.indexOf('<table class="items">'),
    );
  });

  it("ô tiền trong bảng KHÔNG kèm ký hiệu đ", () => {
    const t = bangHang();
    const tbody = t.slice(t.indexOf("<tbody>"), t.indexOf("</tbody>"));
    expect(tbody).toContain("237,600");
    expect(tbody).not.toMatch(/237,600\s*đ/);
    expect(tbody).not.toMatch(/1,663,200\s*đ/);
  });

  it("khối tổng cũng bỏ đuôi đ nhưng giữ nguyên con số", () => {
    expect(html).toContain("2,632,080");
    expect(html).toContain("3,812,080");
    expect(html).not.toMatch(/2,632,080\s*đ/);
    expect(html).not.toMatch(/3,812,080\s*đ/);
  });

  it("ĐVT là CỘT RIÊNG ngay sau Tên hàng, ô Số lượng chỉ còn con số", () => {
    const t = bangHang();
    const thead = t.slice(t.indexOf("<thead>"), t.indexOf("</thead>"));
    // thứ tự tiêu đề: STT → Tên hàng → ĐVT → Số lượng
    expect(thead.indexOf("Tên hàng")).toBeLessThan(thead.indexOf("ĐVT"));
    expect(thead.indexOf("ĐVT")).toBeLessThan(thead.indexOf("Số lượng"));
    const tbody = t.slice(t.indexOf("<tbody>"), t.indexOf("</tbody>"));
    // đơn vị nằm ở ô riêng căn giữa
    expect(tbody).toContain('<td class="center">Kg</td>');
    expect(tbody).toContain('<td class="center">Túi</td>');
    // KHÔNG còn dính đuôi đơn vị trong ô số lượng
    expect(tbody).not.toContain('<span class="unit">');
  });

  it("A5 áp dụng y như A4", () => {
    const a5 = generateDocumentHtml(PHIEU, "A5");
    expect(a5).toContain("Đơn vị tiền tệ: Đồng");
    expect(a5).not.toMatch(/2,632,080\s*đ/);
  });
});

describe("Bill nhiệt — GIỮ NGUYÊN ký hiệu đ, không chèn dòng đơn vị tính", () => {
  const bill = generateDocumentHtml(PHIEU, "80mm");

  it("vẫn in 'đ' cạnh số tiền", () => {
    expect(bill).toMatch(/237,600\s*đ/);
  });

  it("không chèn dòng đơn vị tiền tệ vào khổ hẹp", () => {
    expect(bill).not.toContain("Đơn vị tiền tệ");
  });

  it("bill nhiệt vẫn ghép đơn vị cạnh số lượng (không có bảng cột)", () => {
    expect(bill).toMatch(/7\s*Kg/);
  });

  it("khối tổng của bill giữ nguyên đuôi đ", () => {
    expect(bill).toMatch(/2,632,080\s*đ/);
  });
});
