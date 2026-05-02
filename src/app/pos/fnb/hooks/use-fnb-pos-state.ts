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

/**
 * Build stable topping signature for dedup. Sort theo productId rồi join
 * "id:qty" để cùng set topping (bất kể order nhập) có cùng signature.
 *
 * Trước đây dùng `JSON.stringify(toppings)` → key order không guarantee
 * → cùng món cùng topping nhưng tick checkbox khác thứ tự = 2 line riêng,
 * bếp nhận 2 ticket cho cùng nhu cầu khách.
 */
function toppingSignature(toppings: FnbCartTopping[]): string {
  if (!toppings || toppings.length === 0) return "";
  return [...toppings]
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .map((t) => `${t.productId}:${t.quantity}`)
    .join("|");
}

export interface UseFnbPosStateReturn {
  // Tabs
  tabs: FnbTabSnapshot[];
  activeTabId: string;
  activeTab: FnbTabSnapshot | undefined;
  createTab: (label: string, orderType: OrderType, tableId?: string) => string;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  /** Reset toàn bộ tabs về 1 tab "Mang về #1" rỗng. Dùng khi đổi chi nhánh. */
  resetAllTabs: () => void;
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

  // POS-FIX-B2: Reset all tabs khi đổi branch — tránh gửi đơn từ cart cũ
  // sang quán mới (productId có thể không tồn tại ở branch mới hoặc tệ hơn:
  // bếp pha món sai chi nhánh).
  const resetAllTabs = useCallback(() => {
    const fresh: FnbTabSnapshot = {
      id: nextTabId(),
      label: "Mang về #1",
      orderType: "takeaway",
      customerName: "Khách lẻ",
      lines: [],
    };
    setTabs([fresh]);
    setActiveTabId(fresh.id);
  }, []);

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
      // Check if same product+variant+note+toppings already exists → merge qty.
      // POS-FIX-B4: dùng stable signature thay vì JSON.stringify (object key
      // order không guarantee → cùng món cùng topping bị thêm 2 line riêng,
      // bếp nhận 2 ticket, khách bill double).
      const inputToppingSig = toppingSignature(input.toppings);
      updateActiveTab((lines) => {
        const existing = lines.find(
          (l) =>
            l.productId === input.productId &&
            l.variantId === input.variantId &&
            (l.note ?? "") === (input.note ?? "") &&
            toppingSignature(l.toppings) === inputToppingSig
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
    resetAllTabs,
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
