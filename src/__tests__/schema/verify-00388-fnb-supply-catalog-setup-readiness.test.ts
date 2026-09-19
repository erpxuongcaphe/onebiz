import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/verify/00388_fnb_supply_catalog_setup_readiness.sql"),
  "utf8",
);

function executable(source: string) {
  return source.replace(/^\s*--.*$/gm, "");
}

describe("00388 F&B supply catalog setup readiness", () => {
  it("is locked to the approved tenant and Xưởng Tư Búa pilot branch", () => {
    expect(sql).toContain("148e8ac5-b891-4de3-9055-cfa41f39ddb0");
    expect(sql).toContain("CNH-XTB");
  });

  it("reviews exact Retail supply SKUs used by parent and size-specific BOMs", () => {
    expect(sql).toContain("public.product_variants");
    expect(sql).toContain("b.variant_id = v.id");
    expect(sql).toContain("so_cong_thuc_tham_chieu");
    expect(sql).toContain("public.fnb_supply_catalog");
  });

  it("remains strictly read-only", () => {
    expect(executable(sql)).not.toMatch(
      /\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i,
    );
  });
});
