import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00288_block_direct_stock_table_mutations.sql",
  ),
  "utf8",
);

describe("00288 direct stock write guard", () => {
  it("changes definitions and privileges without changing business rows", () => {
    expect(migration).not.toMatch(/update\s+public\.(products|branch_stock)\s+set/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.stock_movements/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.stock_movements/i);
  });

  it("blocks browser updates to the company stock snapshot", () => {
    expect(migration).toContain("before update of stock on public.products");
    expect(migration).toContain("PRODUCT_STOCK_DIRECT_UPDATE_BLOCKED");
    expect(migration).toContain("security invoker");
  });

  it.each([
    "branch_stock",
    "stock_movements",
    "product_lots",
    "lot_allocations",
  ])("revokes direct DML on %s", (table) => {
    expect(migration).toMatch(
      new RegExp(
        `revoke insert, update, delete on table public\\.${table}[\\s\\S]*?from anon, authenticated`,
        "i",
      ),
    );
  });

  it("keeps low-level FIFO allocation server-only", () => {
    expect(migration).toMatch(
      /revoke all on function public\.allocate_lots_fifo[\s\S]*from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.allocate_lots_fifo[\s\S]*to service_role/i,
    );
  });
});
