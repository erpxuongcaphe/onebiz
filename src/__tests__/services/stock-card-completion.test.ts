import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getRecordedMovementPrices,
  getSignedStockQuantity,
  getStockMovementTotalValue,
  getStockMovementUnitValue,
} from "@/lib/stock-movement-values";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/00223_stock_card_read_rpc.sql"),
  "utf8",
);
const productPage = readFileSync(
  join(process.cwd(), "src/app/(main)/hang-hoa/page.tsx"),
  "utf8",
);
const stockCardTab = readFileSync(
  join(process.cwd(), "src/components/shared/product-stock-movements-tab.tsx"),
  "utf8",
);
const stockHistoryPage = readFileSync(
  join(process.cwd(), "src/app/(main)/hang-hoa/lich-su-kho/page.tsx"),
  "utf8",
);
const stockPage = readFileSync(
  join(process.cwd(), "src/app/(main)/hang-hoa/ton-kho/page.tsx"),
  "utf8",
);
const productService = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/products.ts"),
  "utf8",
);

describe("stock card completion", () => {
  it("preserves zero but never exports non-finite prices or quantities", () => {
    expect(getStockMovementTotalValue({ type: "export", quantity: 2, unitCost: 0 })).toBe(0);
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(getStockMovementUnitValue({ type: "export", quantity: 2, unitCost: invalid })).toBeNull();
      expect(getStockMovementTotalValue({ type: "import", quantity: invalid, unitPrice: 10 })).toBeNull();
    }
    expect(getStockMovementTotalValue({ type: "export", quantity: Number.MAX_VALUE, unitCost: 10 })).toBeNull();
  });
  it("uses negative quantities for outbound movements", () => {
    expect(getSignedStockQuantity({ type: "export", quantity: 3 })).toBe(-3);
    expect(getSignedStockQuantity({ type: "import", quantity: 3 })).toBe(3);
  });

  it("uses purchase price for inbound and cost for outbound value", () => {
    expect(
      getStockMovementUnitValue({
        type: "import",
        quantity: 2,
        unitPrice: 12,
        unitCost: 9,
      }),
    ).toBe(12);
    expect(
      getStockMovementUnitValue({
        type: "export",
        quantity: 2,
        unitPrice: 12,
        unitCost: 9,
      }),
    ).toBe(9);
    expect(
      getStockMovementTotalValue({
        type: "export",
        quantity: 2,
        unitCost: 9,
      }),
    ).toBe(18);
  });

  it("keeps unknown legacy prices empty instead of inventing a value", () => {
    expect(
      getStockMovementUnitValue({ type: "import", quantity: 1 }),
    ).toBeNull();
    expect(
      getStockMovementTotalValue({ type: "export", quantity: 1 }),
    ).toBeNull();
  });

  it("uses the recorded F&B branch cost for sale, receipt and export", () => {
    const salePrices = getRecordedMovementPrices(
      { type: "out", unit_cost: 6000, unit_price: null },
      { unit_cost: 10000, quantity: 0.1 },
    );
    expect(salePrices).toEqual({ unitCost: 10000, unitPrice: undefined });
    expect(getStockMovementTotalValue({ type: "export", quantity: 0.1, ...salePrices })).toBe(1000);

    const receiptPrices = getRecordedMovementPrices(
      { type: "in", unit_cost: 6000, unit_price: 9000 },
      { unit_cost: 10000, quantity: 2 },
    );
    expect(getStockMovementUnitValue({ type: "import", quantity: 2, ...receiptPrices })).toBe(10000);
    expect(getStockMovementTotalValue({ type: "import", quantity: 2, ...receiptPrices })).toBe(20000);
  });

  it("keeps Retail and legacy movement prices unchanged without a branch cost event", () => {
    expect(getRecordedMovementPrices({ type: "out", unit_cost: 6000, unit_price: null }))
      .toEqual({ unitCost: 6000, unitPrice: undefined });
    expect(getRecordedMovementPrices({ type: "in", unit_cost: 6000, unit_price: 9000 }))
      .toEqual({ unitCost: 6000, unitPrice: 9000 });
    expect(getRecordedMovementPrices(
      { type: "out", unit_cost: 6000, unit_price: null },
      { unit_cost: 10000, quantity: 0 },
    )).toEqual({ unitCost: 6000, unitPrice: undefined });
  });

  it("matches branch-cost events by movement ID across history and stock-card readers", () => {
    expect(productService).toContain('"source_stock_movement_id, unit_cost, quantity"');
    expect(productService).toContain("costs.set(event.source_stock_movement_id, event)");
    expect(productService.match(/loadRecordedBranchCosts\(/g)?.length).toBe(5);
    expect(productService.match(/getRecordedMovementPrices\(/g)?.length).toBe(4);
  });

  it("passes the selected branch from product list to the stock card query", () => {
    expect(productPage).toContain(
      "stockCardBranchId={branchStockView ? activeBranchId : undefined}",
    );
    expect(stockCardTab).toContain("getStockCard(productId, branchId)");
    expect(stockCardTab).toContain("!branchId && <span>");
  });

  it("keeps inventory pages aligned with the global branch scope", () => {
    expect(stockPage).toContain('setBranchFilter(activeBranchId ?? "all")');
    expect(stockHistoryPage).toContain(
      'const [branchFilter, setBranchFilter] = useState<string>(activeBranchId ?? "all")',
    );
    expect(stockHistoryPage).toContain('setBranchFilter(activeBranchId ?? "all")');
    expect(stockPage).toContain('useRevalidateOnFocus(fetchData)');
    expect(stockHistoryPage).toContain('useRevalidateOnFocus(fetchData)');
    expect(stockPage).toContain('key={`${stockRow.id}:${stockRow.updatedAt}`}');
    expect(productPage).toContain(':${product.stock}`}');
  });

  it("labels the two stock exports explicitly and keeps full filtered history export", () => {
    expect(stockCardTab).toContain("Xuất Excel thẻ kho");
    expect(stockHistoryPage).toContain("Xuất Excel lịch sử kho");
    expect(stockHistoryPage).toContain("const CHUNK = 1000");
    expect(stockHistoryPage).toContain("all.push(...r.data)");
    expect(stockHistoryPage).not.toContain("onExport={{");
  });

  it("enforces authenticated permission and branch scope in the RPC", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "public.assert_report_access('inventory.view', p_branch_id)",
    );
    expect(migration).toContain("sm.branch_id = p_branch_id");
  });

  it("calculates deterministic forward balances without changing business rows", () => {
    expect(migration).toContain("order by sm.created_at asc, sm.id asc");
    expect(migration).toContain(
      "rows between unbounded preceding and current row",
    );
    expect(migration).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from)\b/i);
  });
});
