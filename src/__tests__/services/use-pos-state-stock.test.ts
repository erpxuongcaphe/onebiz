import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePosState } from "@/app/pos/hooks/use-pos-state";
import type { Product } from "@/lib/types";

const product = {
  id: "product-1",
  code: "SP-1",
  name: "Product 1",
  stock: 5,
  sellPrice: 100,
  unit: "piece",
  sellUnit: "piece",
  hasBom: false,
} as Product;

describe("usePosState stock refresh", () => {
  it("refreshes stock metadata when adding an existing cart line", () => {
    const { result } = renderHook(() => usePosState());

    act(() => {
      result.current.addLine(product, {
        availableStock: 5,
        stockKnown: true,
      });
    });
    act(() => {
      result.current.addLine(product, {
        availableStock: 0,
        stockKnown: true,
      });
    });

    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]).toEqual(
      expect.objectContaining({
        quantity: 2,
        availableStock: 0,
        stockKnown: true,
      }),
    );
  });

  it("marks restored draft stock unknown until a fresh snapshot arrives", () => {
    const { result } = renderHook(() => usePosState());

    act(() => {
      result.current.loadDraft({
        id: "draft-1",
        code: "NH001",
        revision: 0,
        branchId: "branch-1",
        customerId: null,
        customerName: "Walk-in",
        total: 100,
        subtotal: 100,
        discountAmount: 0,
        itemCount: 1,
        note: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [
          {
            id: "item-1",
            productId: "product-1",
            productName: "Product 1",
            unit: "piece",
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            total: 100,
          },
        ],
      });
    });

    expect(result.current.lines[0].stockKnown).toBe(false);
    act(() => {
      result.current.applyStockSnapshot(
        new Map([
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
        ]),
      );
    });
    expect(result.current.lines[0].stockKnown).toBe(true);
    expect(result.current.lines[0].availableStock).toBe(0);
  });
});
