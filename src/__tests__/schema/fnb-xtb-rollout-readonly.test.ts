import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/FNB-XTB-ROLLOUT-BUOC-1-READONLY.sql"),
  "utf8",
);

function executable(source: string) {
  return source.replace(/^\s*--.*$/gm, "");
}

describe("Xưởng Tư Búa - phân lô nhập liệu FnB", () => {
  it("locks the report to the approved tenant and pilot outlet", () => {
    expect(sql).toContain("148e8ac5-b891-4de3-9055-cfa41f39ddb0");
    expect(sql).toContain("OneBiz Coffee Demo");
    expect(sql).toContain("Xưởng Cà Phê - Xưởng Tư Búa");
    expect(sql).toContain("T1_TENANT_VA_CHI_NHANH");
  });

  it("returns the full menu, grouped rollout totals and per-product gaps", () => {
    expect(sql).toContain("T2_TONG_QUAN_MENU");
    expect(sql).toContain("T3_PHAN_LO_NHOM_MON");
    expect(sql).toContain("T4_MON_CAN_NHAP_LIEU");
    expect(sql).toContain("THIEU_GIA_BAN");
    expect(sql).toContain("THIEU_CONG_THUC");
    expect(sql).toContain("CAN_CHOT_QUY_CACH_TRUOC");
  });

  it("uses the same Xưởng Tư Búa BOM precedence as the server", () => {
    expect(sql).toContain("RIENG_XUONG_TU_BUA");
    expect(sql).toContain("DUNG_CHUNG");
    expect(sql).toContain("b.branch_id = cn.id or b.branch_id is null");
    expect(sql).toContain("case when b.branch_id = cn.id then 0 else 1 end");
    expect(sql).toContain("co_bom_hop_le_tai_xtb");
  });

  it("reads the current category relation rather than an obsolete alias", () => {
    expect(sql).toContain("public.categories c");
    expect(sql).not.toContain("public.product_categories");
  });

  it("reports the effective product or category modifier source", () => {
    expect(sql).toContain("product_modifier_groups");
    expect(sql).toContain("category_modifier_groups");
    expect(sql).toContain("nguon_tuy_chon");
    expect(sql).toContain("tuy_chon_hieu_luc");
  });

  it("is strictly read-only", () => {
    expect(executable(sql)).not.toMatch(
      /\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i,
    );
  });
});
