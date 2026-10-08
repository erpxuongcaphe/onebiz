import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/00449_fnb_effective_modifier_inheritance.sql", "utf8");
const source = readFileSync("supabase/migrations/00377_fnb_variant_satisfies_legacy_size_modifier.sql", "utf8");
describe("00449 effective F&B modifier inheritance", () => {
  it("patches both required and allowed modifier checks, leaving the rest of the implementation intact", () => {
    const old = sql.match(/v_old text := '([^']+)';/)![1];
    const replacement = sql.match(/v_new text := '([\s\S]*?)';/)![1];
    expect(source.split(old)).toHaveLength(3);
    expect(replacement).toContain("own_link.product_id = v_product.id");
    expect(replacement).toContain("own_link.tenant_id = v_tenant_id");
    expect(replacement).toContain("cmg.id is not null and not exists");
    expect(source.replaceAll(old, replacement).replaceAll(replacement, old)).toBe(source);
    expect(sql).toContain("FNB_00449_PREREQUISITE_CHANGED");
    expect(sql).toContain("00377_VARIANT_SATISFIES_LEGACY_SIZE");
  });
  it("does not change business data or expose the private rollback implementation", () => {
    expect(sql).not.toMatch(/\b(update|delete from|insert into)\s+public\./i);
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("begin;");
    expect(sql).toContain("commit;");
  });
});
