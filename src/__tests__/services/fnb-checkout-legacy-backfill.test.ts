import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00373_backfill_legacy_fnb_checkout.sql",
  ),
  "utf8",
);

describe("legacy FnB checkout permission backfill", () => {
  it("requires both historical money-handling permissions", () => {
    expect(migration.match(/permission_code = 'pos_retail\.checkout'/g)).toHaveLength(2);
    expect(
      migration.match(/permission_code = 'finance\.create_transaction'/g),
    ).toHaveLength(2);
    expect(migration).toContain("select id, 'pos_fnb.checkout'");
  });

  it("does not hard-code a person or role name", () => {
    const executableSql = migration.replace(/^--.*$/gm, "");
    expect(executableSql).not.toMatch(/where\s+r\.name/i);
    expect(executableSql).not.toMatch(/\buser_id\b/i);
    expect(executableSql).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    expect(migration).toContain("on conflict (role_id, permission_code) do nothing");
  });

  it("reports any eligible role that remains missing", () => {
    expect(migration).toContain("K1_VAI_TRO_THU_TIEN_CU_DA_CO_CHECKOUT_FNB");
    expect(migration).toContain("not exists (select 1 from missing) as dat");
  });
});
