import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 00302 — Giai đoạn 1: nền tương thích topping F&B (CEO chốt 07/08/2026).
 *
 * Test khoá ĐÚNG NHỮNG GÌ CEO ĐÃ DẶN, để lần sau ai sửa file là biết ngay.
 * Không chạy SQL — kiểm nội dung file trước khi CEO chạy trên Supabase.
 */

const MIG = readFileSync(
  "supabase/migrations/00303_fnb_topping_compat_phase1.sql",
  "utf8",
);
const ROLLBACK = readFileSync(
  "supabase/migrations/00303_rollback_fnb_topping_compat_phase1.sql",
  "utf8",
);
const GOC = readFileSync(
  "supabase/migrations/00251_harden_fnb_send_kitchen.sql",
  "utf8",
).replace(/\r\n/g, "\n");

/** Vân tay hàm đang cài, lấy từ preflight CEO chạy 07/08/2026. */
const VAN_TAY = "695f1b1bfd4cd967297d9b7e75345a4c";

/**
 * Bỏ chú thích SQL trước khi soi RANH GIỚI.
 *
 * Bẫy đã dính 6 lần trong đợt này: chính chú thích giải thích lỗi lại chứa
 * đúng chuỗi đang đi tìm (tên hàm thanh toán, 'NVL-TOP', 'product_id'…) →
 * test báo đỏ oan, hoặc tệ hơn là xanh nhầm vì đếm cả chú thích.
 */
function boChuThichSql(sql: string): string {
  return sql
    .split("\n")
    .map((d) => (d.trim().startsWith("--") ? "" : d.replace(/\s--\s.*$/, "")))
    .join("\n");
}
const MA = boChuThichSql(MIG);

describe("00302 · điều kiện CEO đặt ra", () => {
  it("1. Có bộ chốt vân tay — khác bản đã preflight thì DỪNG, không ghi đè", () => {
    expect(MIG).toContain("do $guard$");
    expect(MIG).toContain(VAN_TAY);
    expect(MIG).toContain("md5(pg_get_functiondef(p.oid))");
    expect(MIG).toContain("raise exception");
    // Bộ chốt phải nằm TRƯỚC create or replace, nếu không thì vô nghĩa.
    expect(MIG.indexOf("$guard$;")).toBeLessThan(
      MIG.indexOf("create or replace function public.fnb_send_to_kitchen_atomic_v2"),
    );
  });

  it("2. Hai khoá chỉ là tạm — có ghi rõ KẾ HOẠCH BỎ product_id", () => {
    expect(MIG).toContain("'productId', v_topping_product.id,");
    expect(MIG).toContain("'product_id', v_topping_product.id,");
    // Chú thích TRONG file SQL viết không dấu — cố ý, tránh lỗi mã hoá khi
    // dán qua trình soạn SQL. Chú thích tiếng Việt có dấu chỉ dùng ở web.
    expect(MIG).toContain("TUONG THICH TAM THOI");
    expect(MIG).toMatch(/KE HOACH BO[\s\S]{0,300}XOA dong 'product_id'/);
  });

  it("3. Ghi vết legacy MỘT dòng mỗi lần gửi — KHÔNG ghi từng topping", () => {
    const chenAudit = MIG.indexOf("insert into public.audit_log");
    expect(chenAudit).toBeGreaterThan(0);
    // Phải nằm SAU vòng lặp món (end loop;) → một dòng cho cả lần gửi.
    const cuoiVongLap = MIG.lastIndexOf("end loop;", chenAudit);
    expect(cuoiVongLap).toBeGreaterThan(0);
    expect(cuoiVongLap).toBeLessThan(chenAudit);
    // Gom danh sách mã, không insert trong vòng lặp topping.
    expect(MIG).toContain("to_jsonb(v_legacy_topping_codes)");
    // ⚠️ Hàm gốc VỐN đã ghi 1 dòng audit 'fnb_send_to_kitchen' mỗi lần gửi.
    // Nên đếm tổng insert = 2 là ĐÚNG. Điều cần khoá là: CHỈ MỘT dòng mang
    // action 'legacy_topping', và nó nằm ngoài mọi vòng lặp.
    // Đếm trên bản ĐÃ BỎ CHÚ THÍCH — chú thích cũng nhắc 'legacy_topping'.
    expect((MA.match(/insert into public\.audit_log/g) ?? []).length).toBe(2);
    expect((MA.match(/'legacy_topping'/g) ?? []).length).toBe(1);
    // Không có insert audit nào nằm giữa hai mốc của vòng lặp topping.
    const dauVongTopping = MA.indexOf("for v_topping in");
    const cuoiVongTopping = MA.indexOf("end loop;", dauVongTopping);
    expect(MA.slice(dauVongTopping, cuoiVongTopping)).not.toContain(
      "insert into public.audit_log",
    );
  });

  it("4a. Luồng cũ: chỉ nhận NVL-TOP%, đúng tenant, đang bật", () => {
    expect(MIG).toContain("v_topping_product.code ilike 'NVL-TOP%'");
    expect(MIG).toContain("and p.tenant_id = v_tenant_id");
    expect(MIG).toContain("and p.is_active;");
  });

  it("4b. Luồng mới: SKU + kênh fnb + BOM THẬT, KHÔNG tin cờ has_bom", () => {
    expect(MIG).toContain("v_topping_product.product_type = 'sku'");
    expect(MIG).toContain("v_topping_product.channel = 'fnb'");
    expect(MIG).toContain("public.get_active_bom_for_branch(");
    expect(MIG).toContain("TOPPING_BOM_MISSING");
    // Không được dùng cờ has_bom làm điều kiện nhận topping.
    expect(MIG).not.toMatch(/if\s+v_topping_product\.has_bom/);
  });

  it("4c. Không thuộc hai luồng → từ chối", () => {
    expect(MIG).toContain("TOPPING_NOT_ELIGIBLE");
  });

  it("5. bomId/isLegacy chỉ GHI NHẬN — ghi rõ chưa giải quyết BOM bị tắt", () => {
    expect(MIG).toContain("'isLegacy', v_topping_is_legacy");
    expect(MIG).toContain("'bomId', v_topping_bom_id");
    expect(MIG).toMatch(/CHUA DUOC DUNG de tru kho/);
    expect(MIG).toMatch(/KHONG giai quyet tinh huong BOM bi tat sau khi gui bep/);
  });
});

describe("00302 · RANH GIỚI — những gì Giai đoạn 1 KHÔNG được làm", () => {
  it("KHÔNG chặn NVL-TOP% (popup hiện tại phải chạy nguyên)", () => {
    // Không được có điều kiện loại trừ NVL-TOP khỏi câu tra sản phẩm.
    expect(MA).not.toContain("not like 'NVL-TOP%'");
    expect(MA).not.toContain("not ilike 'NVL-TOP%'");
    expect(MA).not.toContain("<> 'NVL-TOP'");
  });

  it("KHÔNG tắt nhóm tuỳ chọn Topping", () => {
    // ⚠️ KHÔNG khẳng định "vắng mặt chữ modifier_groups" — hàm gốc VỐN đọc
    // hai bảng đó để kiểm tuỳ chọn hợp lệ. Phải khẳng định vắng mặt HÀNH
    // ĐỘNG GHI, không phải vắng mặt cái tên.
    expect(MA).not.toMatch(/update\s+public\.modifier_(groups|options)/i);
    expect(MA).not.toMatch(/delete\s+from\s+public\.modifier_(groups|options)/i);
    expect(MA).not.toMatch(/insert\s+into\s+public\.modifier_(groups|options)/i);
  });

  it("KHÔNG đụng hàm thanh toán (tên trong chú thích không tính)", () => {
    expect(MA).not.toContain("_fnb_complete_payment_impl_00230");
    expect(MA).not.toContain("fnb_complete_payment_atomic");
  });

  it("KHÔNG đụng dữ liệu kinh doanh — chỉ create or replace function", () => {
    // Ngoài 1 dòng audit_log nằm TRONG thân hàm, migration không được có
    // câu lệnh ghi dữ liệu ở mức file.
    const capFile = MA.replace(
      /create or replace function[\s\S]*?\n\$\$;/g,
      "«THÂN HÀM»",
    );
    expect(capFile).not.toMatch(/^\s*(update|delete|insert|truncate|alter table)\s/im);
  });

  it("KHÔNG đổi đơn vị tồn kho", () => {
    expect(MA).not.toContain("uom_conversions");
    expect(MA).not.toMatch(/update\s+public\.products/i);
  });

  it("Giá vẫn lấy từ máy chủ — guard đổi giá còn nguyên", () => {
    expect(MIG).toContain("v_topping_price := v_topping_product.sell_price;");
    expect(MIG).toContain("TOPPING_PRICE_CHANGED");
  });
});

describe("00302 · file khôi phục", () => {
  it("Chứa NGUYÊN VĂN hàm gốc của 00251, không sửa một ký tự", () => {
    const iDau = GOC.indexOf(
      "create or replace function public.fnb_send_to_kitchen_atomic_v2(",
    );
    const iCuoi = GOC.indexOf("\n$$;", iDau);
    expect(iDau).toBeGreaterThan(0);
    expect(iCuoi).toBeGreaterThan(iDau);
    const hamGoc = GOC.slice(iDau, iCuoi + 4);
    expect(ROLLBACK.replace(/\r\n/g, "\n")).toContain(hamGoc);
  });

  it("Ghi rõ vân tay phải trở lại sau khi khôi phục", () => {
    expect(ROLLBACK).toContain(VAN_TAY);
  });

  it("Bản khôi phục KHÔNG chứa thay đổi của 00302", () => {
    expect(ROLLBACK).not.toContain("TOPPING_BOM_MISSING");
    expect(ROLLBACK).not.toContain("legacy_topping");
    expect(ROLLBACK).not.toContain("isLegacy");
    expect(ROLLBACK).not.toContain("bomId");
    // ⚠️ KHÔNG khẳng định "rollback không chứa 'product_id', v_topping_product.id"
    // — chuỗi đó VỐN CÓ trong hàm gốc ở khối ghi vết đổi giá (v_price_overrides).
    // Kiểm đúng chỗ: trong snapshot topping của bản gốc, 'productId' đi THẲNG
    // xuống 'name', không có khoá 'product_id' chen giữa.
    expect(ROLLBACK.replace(/\r\n/g, "\n")).toContain(
      "'productId', v_topping_product.id,\n          'name', v_topping_product.name,",
    );
  });
});
