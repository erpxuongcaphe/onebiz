import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 00335 — NGÀY HOÁ ĐƠN. Khoá các bất biến ngữ nghĩa để đợt sau không đổi
 * máy móc "created_at → ngay_chung_tu" ở chỗ phải giữ thời gian giao dịch thật.
 *
 * Nguyên tắc (CEO 19–20/08/2026):
 *   • Doanh thu / danh sách hoá đơn / in / Excel / KPI → ngay_chung_tu
 *     (= coalesce(issued_at, created_at), cột SINH của bảng invoices).
 *   • Ca làm việc, sổ quỹ, kho, bếp, thời điểm thao tác → GIỮ created_at.
 *   • Đơn đặt hàng giữ ngày đặt (created_at); đơn bán CON có ngày hoá đơn riêng.
 *
 * Đọc tệp chuẩn hoá CRLF→LF (bài học 00329).
 */

const doc = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

describe("00335 — nơi PHẢI dùng ngày chứng từ", () => {
  it("danh sách hoá đơn lọc + sắp xếp theo ngay_chung_tu (khớp KPI đầu trang)", () => {
    const s = doc("src/lib/services/supabase/invoices.ts");
    expect(s).toContain('params.dateColumn ?? "ngay_chung_tu"');
    expect(s).toContain("applyDateRangeFilter(query, cotNgay, params.filters)");
    // KHÔNG được quay lại helper cứng created_at
    expect(s).not.toContain("applyCreatedAtRangeFilter(query, params.filters)");
  });

  it("mapInvoice trả ngày chứng từ — lan toả danh sách, bản in, Excel", () => {
    const s = doc("src/lib/services/supabase/invoices.ts");
    expect(s).toMatch(/date: row\.ngay_chung_tu \?\? row\.created_at/);
  });

  it("đơn bán CON hiện ngày hoá đơn riêng, không phải ngày tạo", () => {
    const s = doc("src/lib/services/supabase/orders.ts");
    const ham = s.slice(s.indexOf("export async function listChildSales"));
    const than = ham.slice(0, ham.indexOf("\n}"));
    expect(than).toContain("ngay_chung_tu");
    expect(than).not.toMatch(/\.order\("created_at"/);
  });

  it("xuất Excel báo cáo bán hàng đọc issued_at do RPC trả về", () => {
    const s = doc("src/lib/services/supabase/analytics.ts");
    expect(s).toMatch(/createdAt: String\(row\.issued_at \?\? row\.created_at \?\? ""\)/);
  });

  it("type invoices khai báo đủ 3 cột — không được che bằng as any", () => {
    const s = doc("src/lib/supabase/types.ts");
    expect(s).toContain("issued_at: string | null;");
    expect(s).toContain("checkout_client_at: string | null;");
    expect(s).toContain("ngay_chung_tu: string;");
  });
});

describe("00335 — nơi PHẢI giữ thời gian giao dịch thật", () => {
  it("đơn trong ca lọc theo created_at (mốc là giờ mở ca)", () => {
    const s = doc("src/app/pos/components/shift-invoice-drawer.tsx");
    expect(s).toContain('dateColumn: "created_at"');
  });

  it("công nợ NHÀ CUNG CẤP (purchase_orders) giữ created_at", () => {
    const s = doc("src/lib/services/supabase/payments.ts");
    const sau = s.slice(s.indexOf('.from("purchase_orders")'));
    expect(sau).toContain('.select("id, code, created_at, total, paid, debt, status")');
    expect(sau).not.toContain("ngay_chung_tu");
  });

  it("đơn bếp F&B (kitchen_orders) giữ created_at", () => {
    const s = doc("src/lib/services/supabase/fnb-analytics.ts");
    const khoi = s.split('.from("kitchen_orders")').slice(1);
    expect(khoi.length).toBeGreaterThan(0);
    for (const k of khoi) {
      // 400 ký tự đầu sau .from là phần select/filter của chính truy vấn đó
      expect(k.slice(0, 400)).not.toContain("ngay_chung_tu");
    }
  });

  it("sổ quỹ + khách mới + nhật ký thao tác giữ created_at", () => {
    const s = doc("src/lib/services/supabase/dashboard.ts");
    for (const bang of ["cash_transactions", "customers", "audit_log"]) {
      const khoi = s.split(`.from("${bang}")`).slice(1);
      for (const k of khoi) {
        expect(k.slice(0, 400)).not.toContain("ngay_chung_tu");
      }
    }
  });

  it("danh sách ĐƠN ĐẶT HÀNG giữ ngày đặt", () => {
    const s = doc("src/lib/services/supabase/orders.ts");
    expect(s).toContain("applyCreatedAtRangeFilter(query, params.filters)");
  });
});
