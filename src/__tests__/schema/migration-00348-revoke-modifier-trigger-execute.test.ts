import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00348_revoke_modifier_trigger_execute.sql",
  "utf8",
);

describe("00348 - modifier trigger functions are not API routines", () => {
  it("removes every browser and service API role without changing data", () => {
    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
    expect(migration).toContain("notify pgrst, 'reload schema';");
    expect(migration).toMatch(
      /revoke all on function public\.enforce_modifier_option_integrity_00347\(\)\s+from public, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.enforce_modifier_group_integrity_00347\(\)\s+from public, anon, authenticated, service_role;/,
    );
    expect(migration).not.toMatch(
      /\b(?:insert|update|delete|truncate|alter table)\b/i,
    );
  });
});
