import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("00359 modifier default reconciliation", () => {
  const migration = read("supabase/migrations/00359_reconcile_modifier_defaults.sql");
  const postflight = read(
    "docs/qc/sql/00359-MODIFIER-DEFAULTS-POSTFLIGHT-READONLY.sql",
  );

  it("only clears lower-priority duplicate defaults in single-choice groups", () => {
    expect(migration).toContain("partition by o.group_id");
    expect(migration).toContain("order by o.sort_order desc");
    expect(migration).toContain("default_rank > 1");
    expect(migration).toContain("g.rule in ('single', 'single_required')");
    expect(migration).toContain("set is_default = false");
  });

  it("ships a read-only duplicate-default postflight", () => {
    expect(postflight).toContain("K1_KHONG_CON_NHOM_HAI_MAC_DINH");
    expect(postflight).toContain("having count(*) > 1");
    expect(postflight.toLowerCase()).not.toMatch(/\b(update|delete|insert)\b/);
  });
});
