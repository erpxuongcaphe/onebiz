import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00375_revert_inferred_fnb_checkout.sql",
  "utf8",
);

describe("FnB checkout inferred permission rollback", () => {
  it("removes only the inferred FnB checkout role permission", () => {
    expect(migration).toContain("delete from public.role_permissions target");
    expect(migration).toContain("target.permission_code = 'pos_fnb.checkout'");
    expect(migration).toContain("retail.permission_code = 'pos_retail.checkout'");
    expect(migration).toContain(
      "finance.permission_code = 'finance.create_transaction'",
    );
    expect(migration).not.toMatch(/delete from public\.user_permission_overrides/i);
    expect(migration).not.toMatch(
      /target\.permission_code\s*=\s*'pos_retail\.checkout'/i,
    );
  });

  it("preserves roles explicitly seeded for FnB checkout", () => {
    expect(migration).toContain("r.name not in");
    expect(migration).toContain("'Thu ngân F&B'");
    expect(migration).toContain("'Quản lý'");
    expect(migration).toContain("'Chủ cửa hàng'");
  });

  it("has a postflight proving the inferred grant is gone", () => {
    expect(migration).toContain("K1_KHONG_CON_TU_SUY_DIEN_QUYEN_FNB");
    expect(migration).toContain("not exists (select 1 from inferred_fnb_roles) as dat");
    expect(migration).toContain("'quyen_retail_duoc_giu_nguyen', true");
    expect(migration).toContain("'quyen_cap_rieng_khong_bi_sua', true");
  });
});
