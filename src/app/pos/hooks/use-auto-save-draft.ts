"use client";

/**
 * useAutoSaveDraft — auto-save form state vào server (status='draft') liên tục.
 *
 * Sprint POS-RECOVERY-1 (CEO 04/05/2026): cứu data khi cúp điện / sập wifi /
 * hư máy giữa lúc cashier đang tạo đơn. Mở lại web → recovery dialog list các
 * đơn dở để cashier tiếp tục.
 *
 * Cơ chế:
 * 1. Generate `sessionId` (UUID) duy nhất per form session (start/recover).
 * 2. Mỗi keystroke thay đổi state → debounce 1500ms → gọi `saveDraftOrder`
 *    với `{ sessionId, autoSaved: true }` → upsert by session_id.
 * 3. State hash (productId+qty+price+discount+customer+...) để skip save khi
 *    không thay đổi (vd user click ngoài cart, scroll product grid).
 * 4. Khi cart trống → cleanup draft trên server (deleteDraftOrder).
 *
 * Distinguish vs F9 manual:
 * - Auto-save: `autoSaved=true`, TTL 30 ngày, mục đích kỹ thuật (recovery)
 * - F9 manual: `autoSaved=false`, sticky vĩnh viễn, mục đích nghiệp vụ
 */

import { useEffect, useRef } from "react";
import {
  saveDraftOrder,
  deleteDraftOrder,
  type PosCheckoutInput,
  type PosCheckoutItem,
} from "@/lib/services/supabase";
import type { OrderLine, DiscountInput, DeliveryInfo } from "./use-pos-state";

interface AutoSaveSnapshot {
  lines: OrderLine[];
  customer: { id: string; name: string } | null;
  orderDiscount: DiscountInput;
  paymentMethod: "cash" | "transfer" | "card" | "mixed";
  subtotal: number;
  total: number;
  orderDiscountAmount: number;
  lineDiscountTotal: number;
  note?: string;
  deliveryInfo?: DeliveryInfo;
  computeLineTotal: (l: OrderLine) => number;
}

interface UseAutoSaveDraftArgs {
  /** UUID idempotency key — sticky cho session, regen khi clear cart. */
  sessionId: string | null;
  /** Trạng thái cart + customer + payment hiện tại. */
  snapshot: AutoSaveSnapshot;
  /** Context tenant/branch/user — null khi chưa load auth. */
  ctx: {
    tenantId: string;
    branchId: string;
    userId: string;
  } | null;
  /** Bật auto-save (false trong loading state hoặc đang submit). */
  enabled: boolean;
  /**
   * Khi đã có invoiceId (từ recovery hoặc save trước), pass vào để debug.
   * Không dùng cho logic — service tự upsert by sessionId.
   */
  loadedDraftId?: string | null;
}

/**
 * Hook — chỉ side-effects, không return gì.
 *
 * Usage:
 *   useAutoSaveDraft({ sessionId, snapshot: state, ctx, enabled: !submitting });
 */
export function useAutoSaveDraft({
  sessionId,
  snapshot,
  ctx,
  enabled,
}: UseAutoSaveDraftArgs): void {
  const debouncedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedHashRef = useRef<string>("");
  const inFlightRef = useRef<boolean>(false);
  // Track invoice ID đã save (từ saveDraftOrder result) để có thể delete khi
  // cart trống. Lần đầu save chưa có id.
  const savedInvoiceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId || !ctx) return;

    // Hash state để skip save khi không thay đổi
    const stateHash = computeStateHash(snapshot);

    // Cart rỗng → cleanup draft trên server (nếu đã có)
    if (snapshot.lines.length === 0) {
      if (savedInvoiceIdRef.current && stateHash !== lastSavedHashRef.current) {
        const idToDelete = savedInvoiceIdRef.current;
        savedInvoiceIdRef.current = null;
        lastSavedHashRef.current = stateHash;
        // Best-effort cleanup — không block UI
        deleteDraftOrder(idToDelete).catch((err) => {
          console.warn("[useAutoSaveDraft] cleanup failed:", err);
        });
      }
      return;
    }

    if (stateHash === lastSavedHashRef.current) return;
    if (inFlightRef.current) return; // đang save → skip, lần kế sẽ catch up

    if (debouncedRef.current) clearTimeout(debouncedRef.current);
    debouncedRef.current = setTimeout(async () => {
      if (!ctx) return;
      inFlightRef.current = true;
      try {
        const input = buildInput(snapshot, ctx);
        const result = await saveDraftOrder(input, {
          sessionId,
          autoSaved: true,
        });
        savedInvoiceIdRef.current = result.invoiceId;
        lastSavedHashRef.current = stateHash;
      } catch (err) {
        console.warn("[useAutoSaveDraft] save failed:", err);
      } finally {
        inFlightRef.current = false;
      }
    }, 1500);

    return () => {
      if (debouncedRef.current) clearTimeout(debouncedRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId, JSON.stringify(snapshot.lines), snapshot.customer?.id, snapshot.orderDiscount.value, snapshot.orderDiscount.mode, snapshot.paymentMethod, snapshot.note, ctx?.tenantId, ctx?.branchId]);
}

/**
 * Hash state để diff nhanh — chỉ track field ảnh hưởng "đơn":
 * lines (productId+qty+price+discount), customer, orderDiscount, payment, note.
 * Các UI state khác (modal mở/đóng, hover...) không trigger save.
 */
function computeStateHash(s: AutoSaveSnapshot): string {
  return JSON.stringify({
    l: s.lines.map((l) => [
      l.productId,
      l.variantId ?? "",
      l.quantity,
      l.unitPrice,
      l.discount.value,
      l.discount.mode,
    ]),
    c: s.customer?.id ?? "",
    od: [s.orderDiscount.value, s.orderDiscount.mode],
    pm: s.paymentMethod,
    n: s.note ?? "",
  });
}

/** Build PosCheckoutInput từ snapshot + ctx. Tương tự logic trong pos/page.tsx. */
function buildInput(
  s: AutoSaveSnapshot,
  ctx: { tenantId: string; branchId: string; userId: string },
): PosCheckoutInput {
  const items: PosCheckoutItem[] = s.lines.map((l) => ({
    productId: l.productId,
    productName: l.variantLabel ? `${l.productName} · ${l.variantLabel}` : l.productName,
    unit: l.unit,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount:
      l.discount.mode === "percent"
        ? Math.round((l.quantity * l.unitPrice * l.discount.value) / 100)
        : l.discount.value,
    vatRate: l.vatRate ?? 0,
  }));

  return {
    tenantId: ctx.tenantId,
    branchId: ctx.branchId,
    createdBy: ctx.userId,
    customerId: s.customer?.id ?? null,
    customerName: s.customer?.name ?? "Khách lẻ",
    items,
    paymentMethod: s.paymentMethod,
    subtotal: s.subtotal,
    discountAmount: s.orderDiscountAmount + s.lineDiscountTotal,
    total: s.total,
    paid: 0, // draft luôn paid=0
    note: s.note,
  };
}
