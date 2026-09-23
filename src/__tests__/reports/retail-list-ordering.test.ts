import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sharedTable = readFileSync(resolve("src/components/shared/data-table/data-table.tsx"), "utf8");
const productsPage = readFileSync(resolve("src/app/(main)/hang-hoa/page.tsx"), "utf8");
const productsService = readFileSync(resolve("src/lib/services/supabase/products.ts"), "utf8");

describe("Retail list ordering", () => {
  it("does not claim a global sort when only a server page is loaded", () => {
    expect(sharedTable).toContain("manualSorting: serverPaged");
    expect(sharedTable).toContain("enableSorting: !serverPaged || Boolean(onSortingChange)");
  });

  it("orders the complete product result before pagination and exports in that order", () => {
    expect(productsPage).toContain("sortableColumnIds={PRODUCT_SORT_COLUMNS}");
    expect(productsPage).toContain("sortBy: PRODUCT_SORT_FIELDS[sorting[0]?.id]");
    expect(productsPage).toContain("pageSize: 1000");
    expect(productsPage).toContain("rows.length >= result.total");
    expect(productsService).toContain('query = query.order(sortBy, { ascending });');
    expect(productsService).toContain('query = query.order("id", { ascending });');
  });
});
