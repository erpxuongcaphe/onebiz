import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/00405_return_item_source_identity.sql",
  "utf8",
);

describe("sales-return source line identity", () => {
  it("adds a nullable source-line reference without rewriting history", () => {
    expect(sql).toContain("add column if not exists invoice_item_id uuid");
    expect(sql).toContain("references public.invoice_items(id)");
    expect(sql).not.toMatch(/update\s+public\.return_items/i);
  });

  it("patches the authoritative implementation with a guarded fingerprint", () => {
    expect(sql).toContain("_create_sales_return_auth_impl_00244");
    expect(sql).toContain("return_id, invoice_item_id, product_id");
    expect(sql).toContain("v_return_id, v_invoice_item_id, v_line.product_id");
    expect(sql).toContain("differs from reviewed shape");
  });
});

