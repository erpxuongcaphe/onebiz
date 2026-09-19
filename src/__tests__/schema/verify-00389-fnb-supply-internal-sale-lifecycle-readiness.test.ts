import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/verify/00389_fnb_supply_internal_sale_lifecycle_readiness.sql",
  ),
  "utf8",
);

function executable(source: string) {
  return source.replace(/^\s*--.*$/gm, "");
}

describe("00389 F&B internal-sale lifecycle readiness", () => {
  it("is locked to the approved tenant and Xưởng Tư Búa pilot branch", () => {
    expect(sql).toContain("148e8ac5-b891-4de3-9055-cfa41f39ddb0");
    expect(sql).toContain("CNH-XTB");
  });

  it("checks source Retail posting and exact F&B destination receipt", () => {
    expect(sql).toContain("public.internal_sales");
    expect(sql).toContain("public.internal_sale_items");
    expect(sql).toContain("public.stock_movements");
    expect(sql).toContain("sm.reference_type = 'internal_sale'");
    expect(sql).toContain("sm.reference_type = 'bom_consume'");
    expect(sql).toContain("so_luong_nhap_fnb <> d.so_luong_ban_noi_bo");
  });

  it("remains strictly read-only", () => {
    expect(executable(sql)).not.toMatch(
      /\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i,
    );
  });
});
