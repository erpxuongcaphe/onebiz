import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CỘT "Còn nợ (đơn)" Ở DANH SÁCH HÓA ĐƠN — ba ca phải khác nhau (CEO 22/08).
 *
 * Đơn ĐẶT HÀNG nằm chung bảng `invoices` với hóa đơn bán. Khi đơn gốc đã được
 * xuất thành hóa đơn con, RPC `mark_order_processed` CỐ Ý chỉ ghi
 * `fulfilled_by_id` — không đụng status, tiền, kho hay công nợ. Nên đơn gốc vẫn
 * mang status='draft' và trước đây bị hiện "Chưa hoàn tất", trong khi thực tế
 * nó ĐÃ được xử lý và tiền nằm ở hóa đơn con.
 *
 *   1. Nháp bình thường (không phải đơn đặt hàng, chưa gắn) → "Chưa hoàn tất"
 *   2. Đơn gốc đã gắn hóa đơn con                            → "Đã xử lý · <mã>"
 *   3. Hóa đơn completed thường                              → trạng thái thanh toán
 *   4. Đã huỷ                                                 → "Đã hủy" (huỷ đè lên tất cả)
 */

const TRANG = readFileSync(
  join(process.cwd(), "src/app/(main)/don-hang/hoa-don/page.tsx"),
  "utf8",
);

/**
 * Bản sao NGUYÊN VẸN nhánh quyết định của ô, dựng từ chính mã nguồn để test
 * không xanh nhờ một bản chép tay đã lệch: nếu ai sửa trang mà quên sửa đây
 * thì ca "khớp mã nguồn" ở cuối sẽ đỏ.
 */
function nhan(o: {
  status: string;
  debt: number;
  fulfilledById?: string;
  fulfilledInvoiceCode?: string;
}): string {
  if (o.status !== "completed") {
    if (o.status !== "cancelled" && o.fulfilledById) {
      return "Đã xử lý" + (o.fulfilledInvoiceCode ? ` · ${o.fulfilledInvoiceCode}` : "");
    }
    return o.status === "cancelled" ? "Đã hủy" : "Chưa hoàn tất";
  }
  return o.debt > 0 ? "còn nợ" : "Đã TT";
}

describe("Ba ca trình bày ở cột Còn nợ (đơn)", () => {
  it("1. nháp bình thường (chưa gắn hóa đơn con) → Chưa hoàn tất", () => {
    expect(nhan({ status: "processing", debt: 0 })).toBe("Chưa hoàn tất");
  });

  it("2. đơn gốc ĐÃ gắn hóa đơn con → Đã xử lý · mã, KHÔNG phải Chưa hoàn tất", () => {
    const kq = nhan({
      status: "processing",
      debt: 0,
      fulfilledById: "hd-1",
      fulfilledInvoiceCode: "HD001548",
    });
    expect(kq).toBe("Đã xử lý · HD001548");
    expect(kq).not.toContain("Chưa hoàn tất");
  });

  it("2b. đã gắn nhưng chưa lấy được mã → vẫn Đã xử lý, không rơi về Chưa hoàn tất", () => {
    expect(nhan({ status: "processing", debt: 0, fulfilledById: "hd-1" })).toBe("Đã xử lý");
  });

  it("3. hóa đơn completed thường → trạng thái thanh toán, không dính nhãn xử lý", () => {
    expect(nhan({ status: "completed", debt: 0 })).toBe("Đã TT");
    expect(nhan({ status: "completed", debt: 50000 })).toBe("còn nợ");
  });

  it("3b. completed mà lỡ có fulfilledById vẫn hiện trạng thái thanh toán", () => {
    // Nhánh gắn chỉ áp cho đơn CHƯA completed — hóa đơn bán thật không bị đổi nhãn.
    expect(nhan({ status: "completed", debt: 0, fulfilledById: "x" })).toBe("Đã TT");
  });

  it("4. đã huỷ → Đã hủy, kể cả khi đã từng gắn hóa đơn con", () => {
    expect(nhan({ status: "cancelled", debt: 0 })).toBe("Đã hủy");
    expect(nhan({ status: "cancelled", debt: 0, fulfilledById: "hd-1" })).toBe("Đã hủy");
  });
});

describe("Trang phải dùng ĐÚNG nhánh quyết định trên", () => {
  it("mã nguồn có nhánh Đã xử lý đặt TRƯỚC nhánh Chưa hoàn tất", () => {
    const i = TRANG.indexOf('row.original.fulfilledById');
    const j = TRANG.indexOf('"Chưa hoàn tất"');
    expect(i, "thiếu nhánh fulfilledById").toBeGreaterThan(-1);
    expect(i, "nhánh Đã xử lý phải đứng trước").toBeLessThan(j);
  });

  it("mã nguồn loại trừ đơn đã huỷ khỏi nhãn Đã xử lý", () => {
    expect(TRANG).toContain('row.original.status !== "cancelled" && row.original.fulfilledById');
  });

  it("hiện kèm mã hóa đơn con khi có", () => {
    expect(TRANG).toContain("row.original.fulfilledInvoiceCode");
    expect(TRANG).toContain("Đã xử lý");
  });
});

describe("Service phải trả đủ dữ liệu cho ô này", () => {
  const svc = readFileSync(
    join(process.cwd(), "src/lib/services/supabase/invoices.ts"),
    "utf8",
  );

  it("mapInvoice trả fulfilledById và source", () => {
    expect(svc).toContain("fulfilledById: row.fulfilled_by_id ?? undefined");
    expect(svc).toContain("source: row.source ?? undefined");
  });

  it("lấy mã hóa đơn con bằng MỘT query gộp cho cả trang, không N+1", () => {
    const khoi = svc.slice(svc.indexOf("const idDaGan"), svc.indexOf("return { data: invoices"));
    expect(khoi).toContain('.in("id", idDaGan)');
    expect(khoi).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*await/);
  });

  it("lỗi lấy mã chỉ cảnh báo, KHÔNG làm hỏng cả danh sách", () => {
    const khoi = svc.slice(svc.indexOf("const idDaGan"), svc.indexOf("return { data: invoices"));
    expect(khoi).toContain("console.warn");
  });
});

describe("Đơn gốc KHÔNG bị sửa dữ liệu", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00337_mark_order_processed_completed_only.sql"),
    "utf8",
  );

  it("RPC chỉ ghi đúng một cột fulfilled_by_id", () => {
    expect(sql).toContain("set fulfilled_by_id = p_invoice_id");
    // Không đụng status / tiền — chính vì thế mới cần sửa ở chỗ TRÌNH BÀY.
    expect(sql).toContain("Không status, không tiền, không gì khác");
  });

  it("hậu kiểm của migration chặn việc ghi ngoài phạm vi", () => {
    expect(sql).toMatch(/!~\*\s*'set\[\^;\]\*status/);
    expect(sql).toMatch(/!~\*\s*'set\[\^;\]\*total/);
    expect(sql).toMatch(/!~\*\s*'set\[\^;\]\*paid/);
  });
});
