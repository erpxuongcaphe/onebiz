import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));

import { getXntReport } from "@/lib/services/supabase/xnt-report";

const migration = readFileSync(
  "supabase/migrations/00259_historical_xnt_report.sql",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/xnt-report.ts",
  "utf8",
);

describe("historical XNT report", () => {
  it("maps server buckets and keeps the stock equation balanced", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          product_id: "product-1",
          code: "SP001",
          name: "Cà phê",
          unit: "kg",
          category_name: "Hạt",
          cost_price: 100_000,
          opening_qty: 10,
          in_supplier: 5,
          in_check: 0,
          in_return: 1,
          in_transfer: 0,
          in_production: 0,
          in_other: 0,
          out_sale: 4,
          out_disposal: 1,
          out_supplier_return: 0,
          out_check: 0,
          out_transfer: 0,
          out_production: 0,
          out_internal: 0,
          out_other: 0,
          closing_qty: 11,
        },
      ],
      error: null,
    });

    const result = await getXntReport({
      range: { from: "2026-07-01", to: "2026-07-31" },
      branchId: "branch-1",
    });

    expect(result.rows[0]).toMatchObject({
      openingQty: 10,
      totalIn: 6,
      totalOut: 5,
      closingQty: 11,
      closingValue: 1_100_000,
    });
    expect(
      result.rows[0].openingQty
        + result.rows[0].totalIn
        - result.rows[0].totalOut,
    ).toBe(result.rows[0].closingQty);
  });

  it("reconstructs historical closing stock from movements after period end", () => {
    expect(migration).toContain("movements_after_period");
    expect(migration).toContain("sm.created_at >= p_date_to");
    expect(migration).toContain(
      "p.current_qty - coalesce(ap.net_after, 0) as closing_at_period",
    );
    expect(migration).toContain(
      "and (p_branch_id is null or sm.branch_id = p_branch_id)",
    );
    expect(migration).toContain("sum(branch_stock.quantity)");
    expect(migration).toContain("coalesce(company_bs.quantity, p.stock, 0)");
    expect(migration).not.toMatch(/\b(update|delete|insert)\s+(into\s+)?public\./i);
  });

  it("uses one server aggregate instead of downloading every stock movement", () => {
    expect(service).toContain('"get_xnt_report"');
    expect(service).not.toContain('.from("stock_movements")');
    expect(service).not.toContain("fetchAllXntRows");
  });
});
