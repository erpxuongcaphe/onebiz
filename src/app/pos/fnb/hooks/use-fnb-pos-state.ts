"use client";

import { useState, useCallback } from "react";
import type {
  FnbOrderLine,
  FnbTabSnapshot,
  FnbCartTopping,
  FnbDiscountInput,
  OrderType,
} from "@/lib/types/fnb";

let lineIdCounter = 0;
function nextLineId(): string {
  return `fnb-line-${++lineIdCounter}-${Date.now()}`;
}

let tabIdCounter = 0;
function nextTabId(): string {
  return `fnb-tab-${++tabIdCounter}-${Date.now()}`;
}

function calcLineTotal(line: Omit<FnbOrderLine, "lineTotal" | "id">): number {
  const base = line.unitPrice * line.quantity;
  const toppingTotal = line.toppings.reduce(
    (sum, t) => sum + t.price * t.quantity * line.quantity,
    0
  );
  return base + toppingTotal;
}

export interface UseFnbPosStateReturn {
  // Tabs
  tabs: FnbTabSnapshot[];
  activeTabId: string;
  activeTab: FnbTabSnapshot | undefined;
  createTab: (label: string, orderType: OrderType, tableId?: string) => string;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  updateTabMeta: (tabId: string, meta: Partial<Pick<FnbTabSnapshot, "customerId" | "customerName" | "kitchenOrderId">>) => void;

  // Cart lines
  addLine: (line: Omit<FnbOrderLine, "id" | "lineTotal">) => void;
  updateLineQty: (lineId: string, qty: number) => void;
  removeLine: (lineId: string) => void;
  clearCart: () => void;

  // Discount
  setOrderDiscount: (tabId: string, discount: FnbDiscountInput | undefined) => void;
  orderDiscountAmount: number;

  // Totals
  subtotal: number;
  total: number;
  lineCount: number;
}

export function useFnbPosState(): UseFnbPosStateReturn {
  const [tabs, setTabs] = useState<FnbTabSnapshot[]>(() => {
    const initialTab: FnbTabSnapshot = {
      id: nextTabId(),
      label: "Mang về #1",
      orderType: "takeaway",
      customerName: "Khách lẻ",
      lines: [],
    };
    return [initialTab];
  });
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // ── Tab management ──

  const createTab = useCallback(
    (label: string, orderType: OrderType, tableId?: string): string => {
      const id = nextTabId();
      const newTab: FnbTabSnapshot = {
        id,
        label,
        orderType,
        tableId,
        customerName: "Khách lẻ",
        lines: [],
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(id);
      return id;
    },
    []
  );

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (next.length === 0) {
          // Always keep at least one tab
          const fallback: FnbTabSnapshot = {
            id: nextTabId(),
            label: "Mang về #1",
            orderType: "takeaway",
            customerName: "Khách lẻ",
            lines: [],
          };
          next.push(fallback);
        }
        if (activeTabId === tabId) {
          setActiveTabId(next[next.length - 1].id);
        }
        return next;
      });
    },
    [activeTabId]
  );

  const updateTabMeta = useCallback(
    (
      tabId: string,
      meta: Partial<Pick<FnbTabSnapshot, "customerId" | "customerName" | "kitchenOrderId">>
    ) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, ...meta } : t))
      );
    },
    []
  );

  // ── Cart lines (scoped to active tab) ──

  const updateActiveTab = useCallback(
    (updater: (lines: FnbOrderLine[]) => FnbOrderLine[]) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, lines: updater(t.lines) } : t
        )
      );
    },
    [activeTabId]
  );

  const addLine = useCallback(
    (input: Omit<FnbOrderLine, "id" | "lineTotal">) => {
      // Check if same product+variant+note already exists → merge qty
      updateActiveTab((lines) => {
        const existing = lines.find(
          (l) =>
            l.productId === input.productId &&
            l.variantId === input.variantId &&
            l.note === input.note &&
            JSON.stringify(l.toppings) === JSON.stringify(input.toppings)
        );
        if (existing) {
          return lines.map((l) =>
            l.id === existing.id
              ? {
                  ...l,
                  quantity: l.quantity + input.quantity,
                  lineTotal: calcLineTotal({
                    ...l,
                    quantity: l.quantity + input.quantity,
                  }),
                }
              : l
          );
        }
        const newLine: FnbOrderLine = {
          ...input,
          id: nextLineId(),
          lineTotal: calcLineTotal(input),
        };
        return [...lines, newLine];
      });
    },
    [updateActiveTab]
  );

  const updateLineQty = useCallback(
    (lineId: string, qty: number) => {
      if (qty <= 0) {
        updateActiveTab((lines) => lines.filter((l) => l.id !== lineId));
        return;
      }
      updateActiveTab((lines) =>
        lines.map((l) =>
          l.id === lineId
            ? { ...l, quantity: qty, lineTotal: calcLineTotal({ ...l, quantity: qty }) }
            : l
        )
      );
    },
    [updateActiveTab]
  );

  const removeLine = useCallback(
    (lineId: string) => {
      updateActiveTab((lines) => lines.filter((l) => l.id !== lineId));
    },
    [updateActiveTab]
  );

  const clearCart = useCallback(() => {
    updateActiveTab(() => []);
  }, [updateActiveTab]);

  // ── Discount ──

  const setOrderDiscount = useCallback(
    (tabId: string, discount: FnbDiscountInput | undefined) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, orderDiscount: discount } : t
        )
      );
    },
    []
  );

  // ── Totals ──

  const lines = activeTab?.lines ?? [];
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const lineCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  const orderDiscountAmount = (() => {
    const disc = activeTab?.orderDiscount;
    if (!disc || disc.value <= 0) return 0;
    if (disc.mode === "amount") return Math.min(disc.value, subtotal);
    // percent
    return Math.round((subtotal * Math.min(disc.value, 100)) / 100);
  })();

  const total = Math.max(subtotal - orderDiscountAmount, 0);

  return {
    tabs,
    activeTabId,
    activeTab,
    createTab,
    switchTab,
    closeTab,
    updateTabMeta,
    addLine,
    updateLineQty,
    removeLine,
    clearCart,
    setOrderDiscount,
    orderDiscountAmount,
    subtotal,
    total,
    lineCount,
  };
}
