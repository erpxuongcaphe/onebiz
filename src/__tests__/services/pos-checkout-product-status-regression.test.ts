import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00296_fix_pos_prepare_product_status.sql",
  "utf8",
);
const invoicePage = readFileSync(
  "src/app/(main)/don-hang/hoa-don/page.tsx",
  "utf8",
);

describe("POS checkout product activity regression", () => {
  it("removes the retired product status predicate from price preparation", () => {
    expect(migration).toContain("pos_prepare_retail_checkout");
    expect(migration).toContain("and p.status = ''active''");
    expect(migration).toContain("checkout_chain_legacy_status_removed");
    expect(migration).toContain("p.is_active");
  });

  it("changes stored function code only and does not write business rows", () => {
    expect(migration).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(migration).not.toMatch(/\bupdate\s+public\./i);
    expect(migration).not.toMatch(/\bdelete\s+from\s+public\./i);
  });

  it("does not label an unfinished zero-debt draft as paid", () => {
    const debtColumn = invoicePage.slice(
      invoicePage.indexOf('accessorKey: "debt"'),
      invoicePage.indexOf('accessorKey: "debt"') + 1_400,
    );

    expect(debtColumn).toContain('row.original.status !== "completed"');
    expect(debtColumn).toContain("Chưa hoàn tất");
    expect(debtColumn).toContain("Đã TT");
    expect(debtColumn.indexOf('row.original.status !== "completed"')).toBeLessThan(
      debtColumn.indexOf("Đã TT"),
    );
  });
});
