import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/00394_report_bom_cogs_invoice_snapshot.sql",
  "utf8",
);

describe("historical BOM COGS report", () => {
  it("uses the invoice cost snapshot and never rewrites retail data", () => {
    expect(sql).toContain("create or replace function public.report_cogs_by_bom(");
    expect(sql).toContain("ii.unit_cost * ii.quantity");
    expect(sql).toContain("else null end");
    expect(sql).toContain("inv.tenant_id = public._current_caller_tenant()");
    expect(sql).not.toMatch(/(?:update|delete from|insert into) public\.(?:products|invoices|invoice_items|stock_movements)\b/i);
    expect(sql).not.toContain("mp.cost_price");
  });
});
