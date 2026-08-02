import { describe, expect, it } from "vitest";
import type { PosStockSnapshot } from "@/lib/services/supabase/pos-stock";
import {
  buildTrackedStockRefreshKey,
  findPosStockShortages,
  mergePosStockSnapshot,
} from "@/app/pos/lib/stock-freshness";

const baseLine = {
  productId: "product-1",
  productName: "Cà phê hạt",
  quantity: 1,
  availableStock: 5,
  stockKnown: true,
  hasBom: false,
};

describe("POS stock freshness", () => {
  it("refreshes when a draft is reopened with the same products", () => {
    const firstDraft = buildTrackedStockRefreshKey([
      { productId: "product-1", lineId: "line-1" },
      { productId: "product-2", lineId: "line-2" },
    ]);
    const reopenedDraft = buildTrackedStockRefreshKey([
      { productId: "product-1", lineId: "line-3" },
      { productId: "product-2", lineId: "line-4" },
    ]);

    expect(reopenedDraft).not.toBe(firstDraft);
  });

  it("updates an existing cart line when fresh branch stock reaches zero", () => {
    const snapshot: PosStockSnapshot = new Map([
      [
        "product-1",
        {
          productId: "product-1",
          availableStock: 0,
          stockKnown: true,
          hasBom: false,
          source: "branch",
        },
      ],
    ]);

    const [updated] = mergePosStockSnapshot([baseLine], snapshot);

    expect(updated.availableStock).toBe(0);
    expect(updated.stockKnown).toBe(true);
    expect(findPosStockShortages([updated])).toEqual([
      expect.objectContaining({
        productId: "product-1",
        required: 1,
        available: 0,
      }),
    ]);
  });

  it("aggregates duplicate cart lines before comparing with stock", () => {
    const lines = [
      { ...baseLine, quantity: 2 },
      { ...baseLine, quantity: 2 },
    ];

    const shortages = findPosStockShortages(lines);

    expect(shortages).toHaveLength(0);
    const lowStockLines = lines.map((line) => ({
      ...line,
      availableStock: 3,
    }));
    expect(findPosStockShortages(lowStockLines)).toEqual([
      expect.objectContaining({ required: 4, available: 3 }),
    ]);
  });

  it("uses the fresh checkout snapshot instead of stale cart stock", () => {
    const snapshot: PosStockSnapshot = new Map([
      [
        "product-1",
        {
          productId: "product-1",
          availableStock: 2,
          stockKnown: true,
          hasBom: false,
          source: "branch",
        },
      ],
    ]);

    expect(
      findPosStockShortages(
        [{ ...baseLine, quantity: 3, availableStock: 20 }],
        snapshot,
      ),
    ).toEqual([expect.objectContaining({ required: 3, available: 2 })]);
  });

  it("keeps BOM shortages identifiable for the existing soft confirmation", () => {
    const snapshot: PosStockSnapshot = new Map([
      [
        "product-1",
        {
          productId: "product-1",
          availableStock: 0,
          stockKnown: true,
          hasBom: true,
          source: "bom",
          bottleneckMaterialName: "Sữa",
        },
      ],
    ]);

    expect(findPosStockShortages([baseLine], snapshot)).toEqual([
      expect.objectContaining({
        source: "bom",
        bottleneckMaterialName: "Sữa",
      }),
    ]);
  });
});
