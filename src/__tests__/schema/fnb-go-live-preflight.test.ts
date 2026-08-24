import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sqlPath = resolve(
  process.cwd(),
  "docs/qc/sql/FNB-GO-LIVE-PREFLIGHT-READONLY.sql",
);
const sql = readFileSync(sqlPath, "utf8");
const dbSchema = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src/__tests__/schema/db-schema.json"),
    "utf8",
  ),
) as { bang: Record<string, string[]> };
const executableSql = sql
  .replace(/--.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("Hậu kiểm trước vận hành FnB", () => {
  it("chỉ đọc, không chứa lệnh thay đổi dữ liệu hoặc cấu trúc", () => {
    expect(executableSql).not.toMatch(
      /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke)\b/i,
    );
  });

  it("chỉ dùng trạng thái đang có thật trên bảng sản phẩm", () => {
    expect(dbSchema.bang.products).toContain("is_active");
    expect(dbSchema.bang.products).not.toContain("deleted_at");
    expect(sql).toContain("p.is_active = true");
    expect(sql).not.toContain("p.deleted_at");
  });

  it("khóa đúng tenant OneBiz đã được xác minh, không còn ô giữ chỗ", () => {
    expect(sql).toContain("148e8ac5-b891-4de3-9055-cfa41f39ddb0");
    expect(sql).toContain("OneBiz Coffee Demo");
    expect(sql).not.toMatch(/DAN_TENANT|TENANT_ID_VAO_DAY/i);
  });

  it("kiểm đường thanh toán V3 đang live và guard gửi bếp 00330", () => {
    expect(sql).toContain("fnb_complete_payment_atomic_v3");
    expect(sql).toContain("00343 phase A:");
    expect(sql).toContain("FNB_PAYMENT_AMOUNT_CHANGED");
    expect(sql).toContain("FNB_DEBT_CONFIRMATION_REQUIRED");
    expect(sql).toContain("fnb_send_to_kitchen_atomic_v2");
    expect(sql).toContain("_fnb_send_to_kitchen_impl_00303");
    expect(sql).toContain("00330:");
    expect(sql).toContain("ham_noi_bo_da_khoa");
  });

  it("kiểm đủ giá topping và công thức theo Size xuyên suốt", () => {
    expect(sql).toContain("GIA_TOPPING_SERVER_00304");
    expect(sql).toContain("get_active_bom_for_branch(uuid,uuid,uuid)");
    expect(sql).toContain("consume_bom_for_sale(uuid,uuid,uuid,numeric");
    expect(sql).toContain("restore_bom_for_return(uuid,uuid,uuid,numeric");
    expect(sql).toContain("quy_cach_thieu_ma_bom");
    expect(sql).toContain("quy_cach_chua_ap_dung_du_chi_nhanh");
  });

  it("đếm các nhóm dữ liệu phải hoàn thiện trước go-live", () => {
    expect(sql).toContain("mon_mot_gia_thieu_gia");
    expect(sql).toContain("mon_sai_so_mac_dinh");
    expect(sql).toContain("dong_bom_sai_luong_hoac_don_vi");
    expect(sql).toContain("tong_topping_sku");
    expect(sql).toContain("lua_chon_co_nguy_co_tru_hai_lan");
    expect(sql).toContain("tram_bep_dang_bat");
    expect(sql).toContain("I2_SIZE_CU_DANG_BAT");
  });

  it("trả kết luận và hướng xử lý rõ ràng bằng tiếng Việt", () => {
    expect(sql).toContain("CHƯA SẴN SÀNG - chưa được bật bán FnB");
    expect(sql).toContain("ĐẠT CỔNG DỮ LIỆU - được phép UAT có kiểm soát");
    expect(sql).toContain("viec_can_lam");
    expect(sql).toContain("DIEU_KIEN");
    expect(sql).toContain("THONG_TIN");
  });
});
