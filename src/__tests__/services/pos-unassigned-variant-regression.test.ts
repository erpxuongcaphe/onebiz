import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/00297_fix_pos_unassigned_variant_record.sql",
);

describe("POS checkout variant record regression", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  it("initializes the variant record before processing every checkout item", () => {
    const initializationIndex = sql.indexOf("into v_variant;");
    const itemParsingIndex = sql.indexOf(
      "v_variant_id := nullif(v_item->>''variantId'', '''')::uuid;",
      initializationIndex,
    );

    expect(initializationIndex).toBeGreaterThan(-1);
    expect(itemParsingIndex).toBeGreaterThan(initializationIndex);
  });

  it("does not modify business data", () => {
    expect(sql).not.toMatch(/^\s*(insert|update|delete|merge|truncate)\b/im);
  });

  it("retains the product activity and retired-column guards", () => {
    expect(sql).toContain("position('p.status' in definition) = 0");
    expect(sql).toContain("position('p.is_active' in definition) > 0");
  });
});
