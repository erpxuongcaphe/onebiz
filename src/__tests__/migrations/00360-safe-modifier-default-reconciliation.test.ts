import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("00360 safe modifier default reconciliation", () => {
  const migration = read(
    "supabase/migrations/00360_safe_modifier_default_reconciliation.sql",
  );
  const postflight = read(
    "docs/qc/sql/00360-MODIFIER-INTEGRITY-POSTFLIGHT-READONLY.sql",
  );

  it("allows only a true-to-false default cleanup with stock fields unchanged", () => {
    expect(migration).toContain("old.is_default");
    expect(migration).toContain("not new.is_default");
    expect(migration).toContain("new.scale_factor is not distinct from old.scale_factor");
    expect(migration).toContain(
      "new.linked_product_id is not distinct from old.linked_product_id",
    );
    expect(migration).toContain("new.is_active is not distinct from old.is_active");
  });

  it("keeps every stock-effect guard", () => {
    expect(migration).toContain("MODIFIER_OPTION_STOCK_EFFECT_CONFLICT");
    expect(migration).toContain("MODIFIER_OPTION_SCALE_FACTOR_NEGATIVE");
    expect(migration).toContain("MODIFIER_OPTION_LINKED_PRODUCT_TENANT_MISMATCH");
  });

  it("reconciles duplicate defaults and audits remaining product links", () => {
    expect(migration).toContain("default_rank > 1");
    expect(postflight).toContain("K1_KHONG_CON_NHOM_HAI_MAC_DINH");
    expect(postflight).toContain("K2_KHONG_TRU_KHO_HAI_LAN");
    expect(postflight).toContain("ma_hang_link");
    expect(postflight).toContain("K4_LINK_HANG_CUNG_CONG_TY");
  });
});
