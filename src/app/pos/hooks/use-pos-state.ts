"use client";

/**
 * usePosState — state hook for POS Terminal (Sprint POS Rev 3)
 *
 * Fresh, minimal implementation. Derived from the older /pos state hook but
 * stripped down for the keyboard-first B2B terminal:
 *  - no tabs, no categories grid, no mobile toggle, no coupons, no shipping
 *  - single cart with order lines
 *  - per-line + order-level discount (% or amount)
 *  - exposes load/save helpers for F9 draft workflow
 */

import { useCallback, useMemo, useState } from "react";
import type { Product } from "@/lib/types";
import type { Customer } from "@/lib/types";
import type { DraftOrderDetail } from "@/lib/services/supabase";

// ============================================================
// Types
// ============================================================

/** Một dòng trong bảng tách thanh toán hỗn hợp */
export interface PaymentBreakdownItem {
  method: "cash" | "transfer" | "card";
  amount: number;
}

/** Snapshot of the entire POS state — used by multi-tab to save/restore tabs */
export interface PosSnapshot {
  lines: OrderLine[];
  customer: Customer | null;
  paymentMethod: PaymentMethod;
  paid: number;
  paymentBreakdown: PaymentBreakdownItem[];
  orderDiscount: DiscountInput;
  note: string;
  loadedDraftId: string | null;
  sellingMode: SellingMode;
  deliveryInfo: DeliveryInfo;
}

export type DiscountMode = "amount" | "percent";

export interface DiscountInput {
  mode: DiscountMode;
  value: number;
}

export interface OrderLine {
  // Local line id (stable across re-renders)
  lineId: string;
  productId: string;
  productCode: string;
  productName: string;
  productImage?: string;
  unit: string;
  availableStock: number;
  quantity: number;
  unitPrice: number;
  discount: DiscountInput;
}

export type PaymentMethod = "cash" | "transfer" | "card" | "mixed";
export type SellingMode = "fast" | "normal" | "delivery";

export interface DeliveryInfo {
  recipientName: string;
  recipientPhone: string;
  address: string;
  ward: string;
  district: string;
  shippingFee: number;
  deliveryNote: string;
  codEnabled: boolean;
}

// ============================================================
// Helpers
// ============================================================

let lineCounter = 0;
function nextLineId(): string {
  return `ln-${++lineCounter}-${Date.now()}`;
}

function computeLineDiscount(line: OrderLine): number {
  const gross = line.quantity * line.unitPrice;
  if (line.discount.mode === "percent") {
    return Math.round((gross * line.discount.value) / 100);
  }
  return Math.max(0, line.discount.value);
}

function computeLineTotal(line: OrderLine): number {
  return Math.max(0, line.quantity * line.unitPrice - computeLineDiscount(line));
}

// ============================================================
// Hook
// ============================================================

export function usePosState() {
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paid, setPaid] = useState<number>(0);
  const [orderDiscount, setOrderDiscount] = useState<DiscountInput>({
    mode: "amount",
    value: 0,
  });
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdownItem[]>([
    { method: "cash", amount: 0 },
    { method: "transfer", amount: 0 },
    { method: "card", amount: 0 },
  ]);
  const [note, setNote] = useState<string>("");
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const [sellingMode, setSellingMode] = useState<SellingMode>("normal");
  const [deliveryInfo, setDeliveryInfo] = useState<DeliveryInfo>({
    recipientName: "",
    recipientPhone: "",
    address: "",
    ward: "",
    district: "",
    shippingFee: 0,
    deliveryNote: "",
    codEnabled: true,
  });

  // --- Actions ---

  const addLine = useCallback((product: Product): void => {
    setLines((prev) => {
      // If same product already in cart, bump quantity
      const existingIdx = prev.findIndex((l) => l.productId === product.id);
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = {
          ...next[existingIdx],
          quantity: next[existingIdx].quantity + 1,
        };
        return next;
      }
      return [
        ...prev,
        {
          lineId: nextLineId(),
          productId: product.id,
          productCode: product.code,
          productName: product.name,
          productImage: product.image,
          unit: product.sellUnit ?? product.unit ?? "Cái",
          availableStock: product.stock ?? 0,
          quantity: 1,
          unitPrice: product.sellPrice ?? 0,
          discount: { mode: "amount", value: 0 },
        },
      ];
    });
  }, []);

  const removeLine = useCallback((lineId: string): void => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  }, []);

  const updateLineQty = useCallback((lineId: string, qty: number): void => {
    setLines((prev) => {
      if (qty <= 0) return prev.filter((l) => l.lineId !== lineId);
      return prev.map((l) =>
        l.lineId === lineId ? { ...l, quantity: qty } : l
      );
    });
  }, []);

  const updateLinePrice = useCallback((lineId: string, price: number): void => {
    setLines((prev) =>
      prev.map((l) =>
        l.lineId === lineId ? { ...l, unitPrice: Math.max(0, price) } : l
      )
    );
  }, []);

  const updateLineDiscount = useCallback(
    (lineId: string, discount: DiscountInput): void => {
      setLines((prev) =>
        prev.map((l) => (l.lineId === lineId ? { ...l, discount } : l))
      );
    },
    []
  );

  const clearCart = useCallback((): void => {
    setLines([]);
    setCustomer(null);
    setPaid(0);
    setPaymentBreakdown([
      { method: "cash", amount: 0 },
      { method: "transfer", amount: 0 },
      { method: "card", amount: 0 },
    ]);
    setOrderDiscount({ mode: "amount", value: 0 });
    setNote("");
    setLoadedDraftId(null);
    setDeliveryInfo({
      recipientName: "",
      recipientPhone: "",
      address: "",
      ward: "",
      district: "",
      shippingFee: 0,
      deliveryNote: "",
      codEnabled: true,
    });
  }, []);

  const loadDraft = useCallback((draft: DraftOrderDetail): void => {
    setLoadedDraftId(draft.id);
    setLines(
      draft.items.map((it) => ({
        lineId: nextLineId(),
        productId: it.productId,
        productCode: "",
        productName: it.productName,
        unit: it.unit,
        availableStock: 0, // unknown from draft row — oversell check will re-fetch if needed
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: { mode: "amount", value: it.discount },
      }))
    );
    // Customer resolution (draft stores id+name, not full object).
    if (draft.customerId) {
      setCustomer({
        id: draft.customerId,
        code: "",
        name: draft.customerName,
        phone: "",
        currentDebt: 0,
        totalSales: 0,
        totalSalesMinusReturns: 0,
        type: "individual",
        createdAt: draft.createdAt,
      });
    } else {
      setCustomer(null);
    }
    setOrderDiscount({ mode: "amount", value: draft.discountAmount });
    setNote(draft.note ?? "");
    setPaid(0);
  }, []);

  // --- Computed totals ---

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
    [lines]
  );

  const lineDiscountTotal = useMemo(
    () => lines.reduce((sum, l) => sum + computeLineDiscount(l), 0),
    [lines]
  );

  const afterLineDiscount = Math.max(0, subtotal - lineDiscountTotal);

  const orderDiscountAmount = useMemo(() => {
    if (orderDiscount.mode === "percent") {
      return Math.round((afterLineDiscount * orderDiscount.value) / 100);
    }
    return Math.max(0, orderDiscount.value);
  }, [orderDiscount, afterLineDiscount]);

  const shippingFee = sellingMode === "delivery" ? deliveryInfo.shippingFee : 0;
  const total = Math.max(0, afterLineDiscount - orderDiscountAmount + shippingFee);
  const debt = Math.max(0, total - paid);
  const change = Math.max(0, paid - total);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  // --- Snapshot: save/restore for multi-tab ---

  /** Cập nhật số tiền cho 1 phương thức trong breakdown, tự tính lại paid */
  const updateBreakdownAmount = useCallback(
    (method: "cash" | "transfer" | "card", amount: number): void => {
      setPaymentBreakdown((prev) => {
        const next = prev.map((b) =>
          b.method === method ? { ...b, amount: Math.max(0, amount) } : b
        );
        // Auto-sync paid = tổng breakdown
        const totalBreakdown = next.reduce((s, b) => s + b.amount, 0);
        setPaid(totalBreakdown);
        return next;
      });
    },
    []
  );

  /** Tổng số tiền đã nhập trong breakdown */
  const breakdownTotal = useMemo(
    () => paymentBreakdown.reduce((s, b) => s + b.amount, 0),
    [paymentBreakdown]
  );

  const getSnapshot = useCallback((): PosSnapshot => ({
    lines,
    customer,
    paymentMethod,
    paid,
    paymentBreakdown,
    orderDiscount,
    note,
    loadedDraftId,
    sellingMode,
    deliveryInfo,
  }), [lines, customer, paymentMethod, paid, paymentBreakdown, orderDiscount, note, loadedDraftId, sellingMode, deliveryInfo]);

  const restoreSnapshot = useCallback((snap: PosSnapshot): void => {
    setLines(snap.lines);
    setCustomer(snap.customer);
    setPaymentMethod(snap.paymentMethod);
    setPaid(snap.paid);
    setPaymentBreakdown(snap.paymentBreakdown ?? [
      { method: "cash", amount: 0 },
      { method: "transfer", amount: 0 },
      { method: "card", amount: 0 },
    ]);
    setOrderDiscount(snap.orderDiscount);
    setNote(snap.note);
    setLoadedDraftId(snap.loadedDraftId);
    setSellingMode(snap.sellingMode);
    setDeliveryInfo(snap.deliveryInfo);
  }, []);

  return {
    // State
    lines,
    customer,
    paymentMethod,
    paid,
    paymentBreakdown,
    orderDiscount,
    note,
    loadedDraftId,
    sellingMode,
    deliveryInfo,

    // Computed
    subtotal,
    lineDiscountTotal,
    orderDiscountAmount,
    shippingFee,
    total,
    debt,
    change,
    itemCount,
    breakdownTotal,

    // Setters
    setCustomer,
    setPaymentMethod,
    setPaid,
    setPaymentBreakdown,
    setOrderDiscount,
    setNote,
    setSellingMode,
    setDeliveryInfo,

    // Mixed payment helpers
    updateBreakdownAmount,

    // Actions
    addLine,
    removeLine,
    updateLineQty,
    updateLinePrice,
    updateLineDiscount,
    clearCart,
    loadDraft,

    // Snapshot (multi-tab)
    getSnapshot,
    restoreSnapshot,

    // Utility
    computeLineTotal,
  };
}

export type PosState = ReturnType<typeof usePosState>;
