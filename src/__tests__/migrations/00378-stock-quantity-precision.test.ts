import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00378_stock_quantity_precision_4dp.sql",
  "utf8",
).toLowerCase();
const rollback = readFileSync(
  "supabase/migrations/00378_rollback_stock_quantity_precision_4dp.sql",
  "utf8",
).toLowerCase();

describe("migration 00378 stock quantity precision", () => {
  it("aligns every stock source of truth and inventory checks to four decimals", () => {
    expect(migration).toContain("alter table public.products");
    expect(migration).toContain("alter table public.branch_stock");
    expect(migration).toContain("alter table public.stock_movements");
    expect(migration).toContain("alter table public.inventory_check_items");
    expect(migration.match(/type numeric\(18,4\)/g)).toHaveLength(9);
  });

  it("fails atomically if widening changes existing Retail aggregates", () => {
    expect(migration).toContain("_stock_precision_00378_before");
    expect(migration).toContain("00378_existing_stock_changed");
    expect(migration).toContain("lock_timeout = '5s'");
  });

  it("does not mutate business rows", () => {
    expect(migration).not.toMatch(/update public\./);
    expect(migration).not.toMatch(/delete from public\./);
    expect(migration).not.toMatch(/insert into public\./);
  });

  it("blocks a rollback that would round new precise quantities", () => {
    expect(rollback).toContain("00378_rollback_would_lose_stock_precision");
    expect(rollback).toContain("quantity <> round(quantity, 2)");
  });
});
