import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * CEO 16/08/2026 — tồn theo lô phải là TỒN VẬT LÝ.
 *
 * Lô 'cancelled' (phiếu nhập bị huỷ), 'consumed', 'disposed' vẫn giữ
 * `current_qty` làm dấu vết lịch sử. Cộng chúng vào báo cáo là báo thừa hàng
 * không có thật — đúng cái bẫy khiến em từng kết luận sai 32 túi Bột Matcha.
 *
 * Riêng màn LỊCH SỬ LÔ có bộ lọc trạng thái của người dùng thì giữ nguyên.
 */

const doc = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const DASHBOARD = doc("src/lib/services/supabase/production-dashboard.ts");
const REPORTS = doc("src/lib/services/supabase/reports.ts");
const ALERT_LOTS_SQL = doc("supabase/migrations/20261113102711_staff_financial_alert_lots_compat.sql");
const PRODUCTION = doc("src/lib/services/supabase/production.ts");

/** Cắt lấy khối truy vấn bắt đầu từ .from("product_lots") */
function khoiTruyVan(src: string, tuViTri = 0): string {
  const i = src.indexOf('.from("product_lots")', tuViTri);
  expect(i, "không thấy truy vấn product_lots").toBeGreaterThan(-1);
  return src.slice(i, i + 700);
}

describe("cảnh báo hạn dùng — chỉ đếm lô còn tồn vật lý", () => {
  it("bảng điều khiển sản xuất loại lô huỷ/đã dùng hết/đã huỷ bỏ", () => {
    const k = khoiTruyVan(DASHBOARD);
    expect(k).toContain('.in("status", ["active", "expired"])');
    expect(k).toContain('.gt("current_qty", 0)');
  });

  it("báo cáo hạn dùng loại lô huỷ/đã dùng hết/đã huỷ bỏ", () => {
    expect(REPORTS).toContain('rpc("get_financial_alert_lots"');
    expect(ALERT_LOTS_SQL).toContain("l.status in ('active','expired')");
    expect(ALERT_LOTS_SQL).toContain("l.current_qty>0");
  });

  it("chỉ nhận 'active' và 'expired' — không nhận cancelled/consumed/disposed", () => {
    const k = khoiTruyVan(DASHBOARD);
    for (const xau of ["cancelled", "consumed", "disposed"]) {
      expect(k, `không được liệt kê ${xau} là tồn vật lý`).not.toContain(`"${xau}"`);
      expect(ALERT_LOTS_SQL).not.toContain(`'${xau}'`);
    }
  });

  it("lô đã huỷ mà còn số lượng vẫn KHÔNG lọt vào (điều kiện là VÀ, không phải HOẶC)", () => {
    // Cả hai điều kiện phải cùng nằm trong một chuỗi truy vấn: còn số lượng
    // là chưa đủ, trạng thái phải hợp lệ.
    const k = khoiTruyVan(DASHBOARD);
    const iQty = k.indexOf('.gt("current_qty", 0)');
    const iStatus = k.indexOf('.in("status", ["active", "expired"])');
    expect(iQty).toBeGreaterThan(-1);
    expect(iStatus).toBeGreaterThan(-1);
    expect(Math.abs(iStatus - iQty)).toBeLessThan(400);
    expect(ALERT_LOTS_SQL).toMatch(/l\.current_qty>0\s+and l\.status in \('active','expired'\)/);
  });
});

describe("màn lịch sử lô giữ nguyên bộ lọc của người dùng", () => {
  it("không bị ép cứng trạng thái", () => {
    const k = khoiTruyVan(PRODUCTION);
    expect(k).not.toContain('.in("status", ["active", "expired"])');
    expect(PRODUCTION).toContain('options.status !== "all"');
    expect(PRODUCTION).toContain('query.eq("status", options.status)');
  });
});
