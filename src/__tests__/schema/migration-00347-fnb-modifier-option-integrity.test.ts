import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00347_fnb_modifier_option_integrity.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/migrations/00347_rollback_fnb_modifier_option_integrity.sql",
  "utf8",
);
const postflight = readFileSync(
  "docs/qc/sql/00347-FNB-MODIFIER-POSTFLIGHT-READONLY.sql",
  "utf8",
);
const preflight = readFileSync(
  "docs/qc/sql/00347-FNB-MODIFIER-PREFLIGHT-READONLY.sql",
  "utf8",
);
const privilegeHotfix = readFileSync(
  "supabase/migrations/00348_revoke_modifier_trigger_execute.sql",
  "utf8",
);
const toppingDiagnosis = readFileSync(
  "docs/qc/sql/00347-FNB-TOPPING-OPTION-READONLY.sql",
  "utf8",
);

describe("00347 - integrity of FnB modifier options", () => {
  it("installs database guards without rewriting business data", () => {
    const topLevel = migration
      .replace(/\$function\$[\s\S]*?\$function\$/g, "")
      .replace(/^\s*--.*$/gm, "");

    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
    expect(migration).toContain("trg_enforce_modifier_option_integrity_00347");
    expect(migration).toContain("trg_enforce_modifier_group_integrity_00347");
    expect(migration).toContain("for update");
    expect(migration).toContain("MODIFIER_OPTION_STOCK_EFFECT_CONFLICT");
    expect(migration).toContain("MODIFIER_OPTION_LINKED_PRODUCT_TENANT_MISMATCH");
    expect(migration).toContain("MODIFIER_SINGLE_GROUP_MULTIPLE_DEFAULTS");
    expect(migration).toContain("revoke all on function");
    expect(topLevel).not.toMatch(
      /^\s*(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+)/gim,
    );
  });

  it("makes a later default replace the prior default atomically", () => {
    expect(migration).toContain("and o.id is distinct from new.id");
    expect(migration).toContain("set is_default = false");
    expect(migration).toContain("v_group_rule in ('single', 'single_required')");
  });

  it("has a rollback and a read-only report for pre-existing bad setup", () => {
    expect(rollback).toContain("drop trigger if exists trg_enforce_modifier_option_integrity_00347");
    expect(rollback).toContain("drop function if exists public.enforce_modifier_option_integrity_00347()");
    expect(postflight).toContain("K3_KHONG_TRU_KHO_HAI_LAN");
    expect(postflight).toContain("K4_MOI_NHOM_CHON_MOT_CO_MOT_MAC_DINH");
    expect(postflight).toContain("option_service_role");
    expect(postflight).toContain("group_service_role");
    expect(postflight).toContain("ma_hang_lien_ket");
    expect(postflight).toContain("ten_hang_lien_ket");
    expect(privilegeHotfix).toContain("authenticated, service_role");
    expect(postflight).not.toMatch(/\b(?:insert|update|delete|truncate)\s+/i);
    expect(preflight).toContain("P2_KHONG_TRU_KHO_HAI_LAN");
    expect(preflight).toContain("P3_MOI_NHOM_CHON_MOT_CO_MOT_MAC_DINH");
    expect(preflight).toContain("ma_hang_lien_ket");
    expect(preflight).not.toMatch(/\b(?:insert|update|delete|truncate)\s+/i);
    expect(toppingDiagnosis).toContain("T1_TOPPING_HIEN_TAI");
    expect(toppingDiagnosis).toContain("T2_MON_DANG_DUNG_TOPPING");
    expect(toppingDiagnosis).not.toMatch(/\b(?:insert|update|delete|truncate)\s+/i);
  });
});
