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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/lib/types";
import type { Customer } from "@/lib/types";
import type { DraftOrderDetail } from "@/lib/services/supabase";
import type { PosStockSnapshot } from "@/lib/services/supabase/pos-stock";
import { mergePosStockSnapshot } from "../lib/stock-freshness";
import { logCustomerChange } from "../lib/customer-blackbox";

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
  loadedDraftRevision?: number | null;
  loadedDraftSource?: string | null;
  sellingMode: SellingMode;
  deliveryInfo: DeliveryInfo;
  /** P0-1 fix 12/06/2026: VAT đơn cấp đơn (0/5/8/10). Multi-tab save/restore. */
  orderVatRate?: number;
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
  /** Khả dụng THẬT lúc thêm — BOM-aware: bằng ĐÚNG số lưới hiển thị
   *  (bomAvailable nếu SP có công thức, product.stock nếu không). */
  availableStock: number;
  hasBom?: boolean;
  /** CEO 08/07: chỉ tô ĐỎ ô số lượng khi BIẾT CHẮC availableStock. true = số từ
   *  lưới (BOM-aware) hoặc SP thường (product.stock là tồn thật). false/undefined
   *  = chưa rõ (nháp, hoặc SP có công thức thêm không qua lưới) → KHÔNG tô đỏ
   *  (tránh đỏ oan món khả dụng-từ-NVL như "Bột frappe ≈8"). */
  stockKnown?: boolean;
  quantity: number;
  unitPrice: number;
  /** Giá niêm yết/giá biến thể để khôi phục khi không còn áp bảng giá. */
  catalogUnitPrice?: number;
  priceSource?: "catalog" | "tier" | "manual" | "server";
  vatRate: number;
  discount: DiscountInput;
  /** Packaging variant (250g, 500g, …). If undefined, line uses base product. */
  variantId?: string;
  variantLabel?: string;
  /** CEO 19/07: ghi chú từng món — lưu invoice_items.note, in ra phiếu. */
  note?: string;
}

/** Optional overrides when adding a line — for variant-based pricing / labelling. */
export interface AddLineOptions {
  variantId?: string;
  variantLabel?: string;
  /** Overrides product.sellPrice (e.g., variant price or tier price). */
  unitPrice?: number;
  catalogUnitPrice?: number;
  priceSource?: OrderLine["priceSource"];
  /** Quantity to add (default 1). */
  quantity?: number;
  /** Khả dụng THẬT (BOM-aware) từ lưới — để giỏ tô đỏ ĐÚNG khi hết hàng. */
  availableStock?: number;
  /** TRUE khi availableStock đáng tin (lưới tính BOM-aware) → cho phép tô đỏ. */
  stockKnown?: boolean;
}

export type PaymentMethod = "cash" | "transfer" | "card" | "mixed";
export type SellingMode = "fast" | "normal" | "delivery";

export interface DeliveryInfo {
  /** Khách hàng được liên kết với người nhận; null khi nhập tay. */
  receiverCustomerId?: string;
  sameAsBuyer?: boolean;
  recipientName: string;
  recipientPhone: string;
  address: string;
  ward: string;
  district: string;
  shippingFee: number;
  deliveryNote: string;
  /**
   * 04/08 (CEO): từ ô tick trang trí thành lựa chọn THẬT.
   *   true  = "Thu COD khi giao" — khách trả khi nhận hàng; ô tiền khách đưa
   *           để 0 (hoặc tiền cọc) là chủ đích, KHÔNG hiện cảnh báo quên gõ
   *           tiền; phần chưa thu thành thu hộ trên vận đơn.
   *   false = "Khách đã thanh toán trước" — thu đủ tại quầy như bán thường.
   * Số tiền chốt vẫn do máy chủ tính (COD = tổng − đã thu) nên chọn nhầm
   * không làm sai sổ. Nháp cũ mặc định true — khớp mặc định giao hàng.
   */
  codEnabled: boolean;
  /** Đối tác giao hàng gán vào vận đơn (04/08). Nháp cũ không có → "". */
  partnerId?: string;
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
  const [customer, setCustomerState] = useState<Customer | null>(null);

  // Hộp đen 28/07: mọi lần đổi khách đi qua setCustomer bọc log (xem
  // customer-blackbox.ts). Ref giữ giá trị hiện tại để log "từ ai → sang ai"
  // mà không dính stale closure.
  const customerRef = useRef<Customer | null>(null);
  const linesCountRef = useRef(0);
  useEffect(() => {
    customerRef.current = customer;
  }, [customer]);
  useEffect(() => {
    linesCountRef.current = lines.length;
  }, [lines.length]);

  const setCustomer = useCallback(
    (next: Customer | null, reason: string = "truc-tiep") => {
      const prev = customerRef.current;
      // Chỉ log khi ĐỔI thật (khác id hoặc khác null-ness) — refetch cùng
      // khách sau F5 không spam log.
      if ((prev?.id ?? null) !== (next?.id ?? null)) {
        logCustomerChange({
          from: prev ? { id: prev.id, name: prev.name } : null,
          to: next ? { id: next.id, name: next.name } : null,
          reason,
          linesCount: linesCountRef.current,
        });
      }
      setCustomerState(next);
    },
    [],
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paid, setPaid] = useState<number>(0);
  const [orderDiscount, setOrderDiscount] = useState<DiscountInput>({
    mode: "amount",
    value: 0,
  });
  // Day 3 16/05/2026: Track OTP context khi cashier xin duyệt discount manual.
  // → service recordDiscountAudit ghi audit_log với link tới manager_otps row.
  const [discountAuditCtx, setDiscountAuditCtx] = useState<{
    otpId: string;
    reason: string;
  } | null>(null);
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdownItem[]>([
    { method: "cash", amount: 0 },
    { method: "transfer", amount: 0 },
    { method: "card", amount: 0 },
  ]);
  const [note, setNote] = useState<string>("");
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const [loadedDraftRevision, setLoadedDraftRevision] = useState<number | null>(null);
  // source của draft đang mở ('order' = đơn đặt hàng) — đổi chữ banner POS.
  const [loadedDraftSource, setLoadedDraftSource] = useState<string | null>(null);
  const [sellingMode, setSellingMode] = useState<SellingMode>("normal");
  // P0-1 fix 12/06/2026: VAT đơn (0/5/8/10%) áp cấp đơn. Trước đây local-state ở
  // pos/page.tsx, render cộng "+orderVatAmount" vào "Khách cần trả" NHƯNG không
  // gắn vào state.total → invoice.total lưu DB THIẾU phần VAT đơn.
  // Nay đưa vào hook + fold vào total → checkout payload truyền đủ.
  const [orderVatRate, setOrderVatRate] = useState<number>(0);
  const [deliveryInfo, setDeliveryInfo] = useState<DeliveryInfo>({
    recipientName: "",
    recipientPhone: "",
    address: "",
    ward: "",
    district: "",
    shippingFee: 0,
    deliveryNote: "",
    codEnabled: true,
    sameAsBuyer: true,
    partnerId: "",
  });

  // --- Actions ---

  const addLine = useCallback(
    (product: Product, options?: AddLineOptions): void => {
      const qtyDelta = options?.quantity ?? 1;
      setLines((prev) => {
        // Match both productId AND variantId so different variants are separate lines.
        // POS-FIX-A5: chỉ merge khi line cũ KHÔNG có discount riêng + cùng
        // unit price. Nếu line cũ đang giảm giá thủ công, tách line mới
        // ở giá gốc — tránh "cho thêm 1 cái free" do discount kế thừa âm thầm.
        const existingIdx = prev.findIndex((l) => {
          if (l.productId !== product.id) return false;
          if ((l.variantId ?? null) !== (options?.variantId ?? null)) return false;
          // Có discount riêng → không merge (tách line mới)
          if (l.discount.value !== 0) return false;
          // Dòng sửa giá tay phải đứng riêng. Giá bảng tự đổi theo tổng số lượng
          // nên so theo giá niêm yết, không so giá đang hiển thị.
          if (l.priceSource === "manual") return false;
          const targetCatalogPrice =
            options?.catalogUnitPrice ?? options?.unitPrice ?? product.sellPrice ?? 0;
          if (
            l.catalogUnitPrice !== undefined &&
            l.catalogUnitPrice !== targetCatalogPrice
          ) return false;
          return true;
        });
        if (existingIdx >= 0) {
          const next = [...prev];
          const freshStock = options?.stockKnown === true
            ? {
                availableStock: options.availableStock ?? 0,
                stockKnown: true as const,
                hasBom: product.hasBom ?? next[existingIdx].hasBom ?? false,
              }
            : {};
          next[existingIdx] = {
            ...next[existingIdx],
            ...freshStock,
            quantity: next[existingIdx].quantity + qtyDelta,
            unitPrice: options?.unitPrice ?? next[existingIdx].unitPrice,
            catalogUnitPrice:
              options?.catalogUnitPrice ??
              next[existingIdx].catalogUnitPrice ??
              product.sellPrice ??
              0,
            priceSource: options?.priceSource ?? next[existingIdx].priceSource,
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
            // Ưu tiên khả dụng BOM-aware từ lưới; fallback product.stock.
            availableStock: options?.availableStock ?? (product.stock ?? 0),
            hasBom: product.hasBom ?? false,
            // SP thường → tồn thật, biết chắc. SP có công thức mà KHÔNG có số từ
            // lưới → chưa rõ khả dụng (không tô đỏ). Lưới truyền stockKnown=true.
            stockKnown: options?.stockKnown ?? !(product.hasBom ?? false),
            quantity: qtyDelta,
            unitPrice: options?.unitPrice ?? product.sellPrice ?? 0,
            catalogUnitPrice:
              options?.catalogUnitPrice ?? options?.unitPrice ?? product.sellPrice ?? 0,
            priceSource: options?.priceSource ?? "catalog",
            vatRate: product.vatRate ?? 0,
            discount: { mode: "amount", value: 0 },
            variantId: options?.variantId,
            variantLabel: options?.variantLabel,
          },
        ];
      });
    },
    []
  );

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

  const updateLinePrice = useCallback((
    lineId: string,
    price: number,
    source: OrderLine["priceSource"] = "manual",
  ): void => {
    setLines((prev) =>
      prev.map((l) =>
        l.lineId === lineId
          ? { ...l, unitPrice: Math.max(0, price), priceSource: source }
          : l
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

  // CEO 19/07: ghi chú từng món. Rỗng → undefined (không lưu chuỗi trống).
  const updateLineNote = useCallback((lineId: string, note: string): void => {
    const trimmed = note.trim();
    setLines((prev) =>
      prev.map((l) =>
        l.lineId === lineId ? { ...l, note: trimmed || undefined } : l
      )
    );
  }, []);

  const applyStockSnapshot = useCallback((snapshot: PosStockSnapshot): void => {
    setLines((prev) => mergePosStockSnapshot(prev, snapshot));
  }, []);

  const clearCart = useCallback((): void => {
    setLines([]);
    setCustomer(null, "clear-cart");
    setPaymentMethod("cash");
    setPaid(0);
    setPaymentBreakdown([
      { method: "cash", amount: 0 },
      { method: "transfer", amount: 0 },
      { method: "card", amount: 0 },
    ]);
    setOrderDiscount({ mode: "amount", value: 0 });
    setDiscountAuditCtx(null);
    setOrderVatRate(0);
    setNote("");
    setLoadedDraftId(null);
    setLoadedDraftRevision(null);
    setLoadedDraftSource(null);
    setSellingMode("normal");
    setDeliveryInfo({
      recipientName: "",
      recipientPhone: "",
      address: "",
      ward: "",
      district: "",
      shippingFee: 0,
      deliveryNote: "",
      codEnabled: true,
      sameAsBuyer: true,
    });
  }, []);

  const loadDraft = useCallback((draft: DraftOrderDetail): void => {
    setDiscountAuditCtx(null);
    setLoadedDraftId(draft.id);
    setLoadedDraftRevision(draft.revision);
    setLoadedDraftSource(draft.source ?? null);
    setLines(
      draft.items.map((it) => ({
        lineId: nextLineId(),
        productId: it.productId,
        productCode: "",
        productName: it.productName,
        unit: it.unit,
        availableStock: 0, // unknown from draft row — oversell check will re-fetch if needed
        quantity: it.quantity,
        stockKnown: false,
        unitPrice: it.unitPrice,
        catalogUnitPrice: it.unitPrice,
        priceSource: "server",
        variantId: it.variantId,
        vatRate: (it as any).vatRate ?? 0,
        discount: { mode: "amount", value: it.discount },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        note: (it as any).note ?? undefined,
      }))
    );
    // Customer resolution (draft stores id+name, not full object).
    if (draft.customerId) {
      setCustomer(
        {
          id: draft.customerId,
          code: "",
          name: draft.customerName,
          phone: "",
          currentDebt: 0,
          totalSales: 0,
          totalSalesMinusReturns: 0,
          type: "individual",
          createdAt: draft.createdAt,
        },
        "load-draft",
      );
    } else {
      setCustomer(null, "load-draft");
    }
    // 28/07 — CHỐNG TRỪ GIẢM GIÁ HAI LẦN khi mở lại đơn nháp.
    // Lúc lưu, cột discount_amount được ghi = giảm giá cả đơn CỘNG tổng chiết
    // khấu từng dòng (xem buildInput trong use-auto-save-draft). Nếu mở lại mà
    // gán nguyên cục đó vào ô giảm giá đơn, trong khi từng dòng vẫn giữ chiết
    // khấu riêng, thì phần chiết khấu dòng bị trừ lần thứ hai — mỗi lần mở lại
    // đơn lại thất thu thêm đúng bằng số đó.
    // Trả lại đúng phần của đơn: tổng đã lưu trừ đi chiết khấu các dòng.
    const lineDiscountSum = draft.items.reduce(
      (sum, it) => sum + (Number(it.discount) || 0),
      0,
    );
    setOrderDiscount({
      mode: "amount",
      value: Math.max(0, (draft.discountAmount ?? 0) - lineDiscountSum),
    });
    setNote(draft.note ?? "");
    setPaymentMethod("cash");
    setPaid(0);
    setPaymentBreakdown([
      { method: "cash", amount: 0 },
      { method: "transfer", amount: 0 },
      { method: "card", amount: 0 },
    ]);
    setOrderVatRate(0);
    const deliveryFee = Math.max(0, Number(draft.deliveryFee ?? 0));
    setSellingMode(deliveryFee > 0 ? "delivery" : "normal");
    setDeliveryInfo({
      recipientName: "",
      recipientPhone: "",
      address: "",
      ward: "",
      district: "",
      shippingFee: deliveryFee,
      deliveryNote: "",
      codEnabled: true,
      sameAsBuyer: true,
    });
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

  // P0-14 fix 12/06/2026: VAT tính trên net (sau cả line discount + order discount).
  // Trước: VAT = (qty*price - lineDisc) * vatRate → bỏ qua order discount → over-VAT
  // Nay: scale theo (after - orderDisc)/after → đúng luật VAT VN (tính trên net).
  const taxAmount = useMemo(() => {
    if (afterLineDiscount <= 0) return 0;
    const discScale = Math.max(0, (afterLineDiscount - orderDiscountAmount) / afterLineDiscount);
    return lines.reduce((sum, l) => {
      const lineNet = (l.quantity * l.unitPrice - computeLineDiscount(l)) * discScale;
      return sum + Math.round(lineNet * (l.vatRate ?? 0) / 100);
    }, 0);
  }, [lines, afterLineDiscount, orderDiscountAmount]);

  const shippingFee = sellingMode === "delivery" ? deliveryInfo.shippingFee : 0;
  // P0-1 fix: orderVatAmount = VAT cấp đơn trên (after - orderDisc + lineVAT + shipping)
  // → fold vào total để checkout payload truyền đủ tiền khách trả.
  const baseBeforeOrderVat = Math.max(0, afterLineDiscount - orderDiscountAmount + taxAmount + shippingFee);
  const orderVatAmount = Math.ceil(baseBeforeOrderVat * orderVatRate / 100);
  const total = baseBeforeOrderVat + orderVatAmount;
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
    loadedDraftRevision,
    loadedDraftSource,
    sellingMode,
    deliveryInfo,
    orderVatRate,
  }), [lines, customer, paymentMethod, paid, paymentBreakdown, orderDiscount, note, loadedDraftId, loadedDraftRevision, loadedDraftSource, sellingMode, deliveryInfo, orderVatRate]);

  /**
   * Phase F5-Recovery (CEO 01/06/2026): khôi phục giỏ từ localStorage backup
   * sau F5/cúp điện. Chỉ set field cốt lõi (lines/customer/discount/note/
   * paymentMethod). Các field khác giữ default. KHÔNG set loadedDraftId để
   * handleComplete đi nhánh posCheckout an toàn (có fallback "still draft").
   */
  const restoreFromLocalBackup = useCallback((data: {
    lines?: OrderLine[];
    /** Slim shape — chỉ id+name; field còn lại default rỗng. */
    customer?: { id: string; name: string } | null;
    orderDiscount?: DiscountInput;
    note?: string;
    paymentMethod?: PaymentMethod;
  }): void => {
    if (data.lines) setLines(data.lines);
    if (data.customer !== undefined) {
      setCustomer(
        data.customer
          ? {
              id: data.customer.id,
              code: "",
              name: data.customer.name,
              phone: "",
              currentDebt: 0,
              totalSales: 0,
              totalSalesMinusReturns: 0,
              type: "individual",
              createdAt: new Date().toISOString(),
            }
          : null,
        "f5-restore",
      );
    }
    if (data.orderDiscount) setOrderDiscount(data.orderDiscount);
    if (data.note !== undefined) setNote(data.note);
    if (data.paymentMethod) setPaymentMethod(data.paymentMethod);
  }, []);

  const restoreSnapshot = useCallback((snap: PosSnapshot): void => {
    setLines(snap.lines);
    setCustomer(snap.customer, "tab-switch");
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
    setLoadedDraftRevision(snap.loadedDraftRevision ?? null);
    setLoadedDraftSource(snap.loadedDraftSource ?? null);
    setSellingMode(snap.sellingMode);
    setDeliveryInfo(snap.deliveryInfo);
    setOrderVatRate(snap.orderVatRate ?? 0);
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
    loadedDraftRevision,
    loadedDraftSource,
    sellingMode,
    deliveryInfo,
    orderVatRate,

    // Computed
    subtotal,
    lineDiscountTotal,
    orderDiscountAmount,
    taxAmount,
    orderVatAmount,
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
    discountAuditCtx,
    setDiscountAuditCtx,
    setNote,
    setSellingMode,
    setDeliveryInfo,
    setOrderVatRate,
    // CEO 04/05 — auto-save callback set khi draft lên server thành công.
    // handleComplete dùng để biết → đi nhánh completeDraftOrder.
    setLoadedDraftId,
    setLoadedDraftRevision,

    // Mixed payment helpers
    updateBreakdownAmount,

    // Actions
    addLine,
    removeLine,
    updateLineQty,
    updateLinePrice,
    updateLineDiscount,
    updateLineNote,
    applyStockSnapshot,
    clearCart,
    loadDraft,
    restoreFromLocalBackup,

    // Snapshot (multi-tab)
    getSnapshot,
    restoreSnapshot,

    // Utility
    computeLineTotal,
  };
}

export type PosState = ReturnType<typeof usePosState>;
