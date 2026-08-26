import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00349_allow_deactivate_invalid_modifier_option.sql",
  "utf8",
);

describe("00349 - retiring an invalid legacy modifier option", () => {
  it("allows only an inactive option to bypass the active configuration checks", () => {
    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
    expect(migration).toContain("if not new.is_active then");
    expect(migration).toContain("return new;");
    expect(migration).toContain("MODIFIER_OPTION_STOCK_EFFECT_CONFLICT");
    expect(migration).toContain("MODIFIER_OPTION_LINKED_PRODUCT_TENANT_MISMATCH");
    expect(migration).toMatch(
      /revoke all on function public\.enforce_modifier_option_integrity_00347\(\)\s+from public, anon, authenticated, service_role;/,
    );
    expect(migration).not.toMatch(
      /\b(?:insert|delete|truncate|alter table)\b/i,
    );
  });
});
