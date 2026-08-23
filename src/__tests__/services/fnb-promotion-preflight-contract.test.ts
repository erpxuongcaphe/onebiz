import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preflight = readFileSync(
  "docs/PREFLIGHT-FNB-KHUYEN-MAI-THANH-TOAN.sql",
  "utf8",
);

function executableSql(value: string) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .trim();
}

describe("F&B promotion payment preflight contract", () => {
  it("keeps the production check as one tenant-scoped read-only SELECT", () => {
    const sql = executableSql(preflight);

    expect(sql).toMatch(/^with\s+tt\s+as\s*\(/i);
    expect(sql).toContain("'DAN_TENANT_ID_VAO_DAY'::uuid");
    expect(sql).toContain("join tenant_duoc_chon");
    expect(sql).not.toMatch(
      /\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|call|do|begin|commit|notify)\b/i,
    );
  });

  it("records the exact payment signature and the promotion conditions to review", () => {
    expect(preflight).toContain("fnb_complete_payment_atomic_v2(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric,uuid,numeric,numeric,text,numeric)");
    expect(preflight).toContain("fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)");
    expect(preflight).toContain("co_kiem_kenh_fnb");
    expect(preflight).toContain("co_kiem_chi_nhanh_ap_dung_km");
    expect(preflight).toContain("co_kiem_gioi_han_luot_dung");
    expect(preflight).toContain("co_kiem_mat_hang_nhom_hang");
    expect(preflight).toContain("ghi_promotion_discount_tu_tham_so_client");
    expect(preflight).toContain("A2C_COUPON_ATOMIC");
    expect(preflight).toContain("A2D_QUYEN_GOI_TRUC_TIEP_THANH_TOAN");
    expect(preflight).toContain("has_function_privilege('authenticated'");
    expect(preflight).toContain("aclexplode(coalesce(h.proacl");
    expect(preflight).toContain("_fnb_send_to_kitchen_impl_00303");
  });
});
