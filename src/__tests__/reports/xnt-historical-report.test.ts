import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));

import { getXntReport } from "@/lib/services/supabase/xnt-report";

const migration = readFileSync(
  "supabase/migrations/00404_historical_xnt_valuation.sql",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/xnt-report.ts",
  "utf8",
);

describe("historical XNT report", () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: [], error: null }); });
  it("maps server buckets and keeps the stock equation balanced", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          product_id: "product-1",
          code: "SP001",
          name: "Cà phê",
          unit: "kg",
          category_name: "Hạt",
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
          out_internal: 2,
          out_other: 0,
          closing_qty: 9,
          opening_value: 1_000_000,
          in_value: 600_000,
          out_value: 700_000,
          closing_value: 900_000,
          valued_movement_count: 8,
          missing_cost_movement_count: 0,
          valuation_complete: true,
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
      outInternal: 2,
      totalOut: 7,
      closingQty: 9,
      closingValue: 900_000,
      valuationComplete: true,
      missingCostMovementCount: 0,
    });
    expect(
      result.rows[0].openingQty
        + result.rows[0].totalIn
        - result.rows[0].totalOut,
    ).toBe(result.rows[0].closingQty);
  });

  it("values history from immutable movement snapshots without current product cost", () => {
    expect(migration).toContain("public.get_xnt_report_v2");
    expect(migration).toContain("cost_event.total_cost");
    expect(migration).toContain("movement.unit_cost");
    expect(migration).toContain("movement.type = 'in' and movement.unit_price is not null");
    expect(migration).toContain("missing_cost_movement_count");
    expect(migration).not.toContain("products.cost_price");
    expect(migration).not.toMatch(/movement\.type\s*=\s*'out'[\s\S]{0,100}unit_price/);
    expect(migration).not.toMatch(/\b(update|delete|insert)\s+(into\s+)?public\./i);
  });

  it("uses one server aggregate instead of downloading every stock movement", () => {
    expect(service).toContain('"get_xnt_report_v2"');
    expect(service).not.toContain('.from("stock_movements")');
    expect(service).not.toContain("fetchAllXntRows");
  });

  it("shows internal issues in both detailed views and exports", () => {
    const page = readFileSync("src/app/(main)/phan-tich/xuat-nhap-ton/page.tsx", "utf8");
    expect(page).toContain('key: "outInternal"');
    expect(page.match(/outInternal: r\.outInternal/g)).toHaveLength(2);
    expect(page).toContain('label: "Xuất nội bộ"');
    expect(page).toContain("Giá trị được tính từ giá vốn chốt tại từng phát sinh kho");
    expect(page).toContain("giá trị từng cột thiếu dữ liệu được để trống để tránh cộng sai");
  });

  it("does not turn incomplete legacy valuation into a plausible zero", async () => {
    rpc.mockResolvedValueOnce({
      data: [{
        product_id: "legacy",
        code: "OLD-001",
        name: "Dòng cũ",
        unit: "Cái",
        opening_qty: 2,
        closing_qty: 2,
        opening_value: null,
        in_value: null,
        out_value: null,
        closing_value: null,
        missing_cost_movement_count: 1,
        valuation_complete: false,
      }],
      error: null,
    });

    const result = await getXntReport({
      range: { from: "2026-07-01", to: "2026-07-31" },
    });

    expect(result.rows[0].closingValue).toBeNull();
    expect(result.rows[0].valuationComplete).toBe(false);
    expect(result.subtotal.closingValue).toBeNull();
    expect(result.subtotal.incompleteValuationCount).toBe(1);
  });

  it("preserves valid period values when opening and closing history are incomplete", async () => {
    rpc.mockResolvedValueOnce({ data: [{
      product_id: "old-opening", code: "NVL-001", name: "Cà phê", unit: "G",
      opening_qty: 10, in_supplier: 2, out_sale: 3, closing_qty: 9,
      opening_value: null, in_value: 300, out_value: 420, closing_value: null,
      valuation_complete: false, missing_cost_movement_count: 1,
    }], error: null });
    const result = await getXntReport({ range: { from: "2026-01-01", to: "2026-01-31" } });
    expect(result.subtotal).toMatchObject({ openingValue: null, inValue: 300, outValue: 420, closingValue: null });
  });
});
