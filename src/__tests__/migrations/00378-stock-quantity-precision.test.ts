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
    expect(migration.match(/type numeric\(18,4\)/g)).toHaveLength(8);
    expect(migration).toContain("add column difference numeric(18,4)");
  });

  it("fails atomically if widening changes existing Retail aggregates", () => {
    expect(migration).toContain("v_before jsonb");
    expect(migration).toContain("v_before is distinct from v_after");
    expect(migration).toContain("00378_existing_stock_changed");
    expect(migration).toContain("lock_timeout = '5s'");
  });

  it("uses transaction-local variables instead of an unprotected table", () => {
    expect(migration).not.toContain("create temporary table");
    expect(migration).not.toContain("create table");
  });

  it("restores the existing direct stock update guard after changing its column", () => {
    expect(migration).toContain(
      "drop trigger trg_guard_direct_product_stock_update_00288",
    );
    expect(migration).toContain(
      "create trigger trg_guard_direct_product_stock_update_00288",
    );
    expect(migration).toContain("00378_product_stock_guard_not_restored");
  });

  it("rebuilds the generated inventory difference around its source columns", () => {
    const dropAt = migration.indexOf("drop column difference");
    const sourceAlterAt = migration.indexOf(
      "alter column system_stock type numeric(18,4)",
    );
    const generatedAt = migration.indexOf(
      "generated always as (actual_stock - system_stock) stored",
    );

    expect(dropAt).toBeGreaterThan(-1);
    expect(sourceAlterAt).toBeGreaterThan(dropAt);
    expect(generatedAt).toBeGreaterThan(sourceAlterAt);
    expect(rollback).toContain("drop column difference");
    expect(rollback).toContain(
      "generated always as (actual_stock - system_stock) stored",
    );
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
