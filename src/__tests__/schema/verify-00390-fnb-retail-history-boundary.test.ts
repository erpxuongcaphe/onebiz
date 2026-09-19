import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/verify/00390_fnb_retail_sales_and_stock_card_boundary.sql"), "utf8");
const executable = sql.replace(/^\s*--.*$/gm, "");

describe("00390 Retail sales and F&B stock-card boundary", () => {
  it("locks the report to Xưởng Tư Búa and the approved tenant", () => {
    expect(sql).toContain("148e8ac5-b891-4de3-9055-cfa41f39ddb0");
    expect(sql).toContain("CNH-XTB");
  });

  it("keeps Retail customer sales, internal supply, and F&B stock separate", () => {
    expect(sql).toContain("left join public.internal_sales noi_bo on noi_bo.invoice_id = i.id");
    expect(sql).toContain("noi_bo.id is null");
    expect(sql).toContain("public.internal_sale_items");
    expect(sql).toContain("public.stock_movements");
  });

  it("remains strictly read-only", () => {
    expect(executable).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
  });
});
