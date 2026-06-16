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

// ════════════════════════════════════════════════════════════════════════════
// Phase F5-Recovery (CEO 01/06/2026): localStorage backup
// ════════════════════════════════════════════════════════════════════════════
// Vấn đề: useAutoSaveDraft DB debounce 400ms — F5/cúp điện trong khoảng đó
// thì DB chưa có gì → mở lại web mất giỏ.
// Fix: ghi localStorage IMMEDIATELY mỗi keystroke (sync, không network). DB
// save vẫn debounce cho performance. Trên mount POS, load LS trước nếu có.
// LS giữ tối thiểu 7 ngày (auto-clear khi cart empty hoặc checkout xong).

const LS_VERSION = "v1";
const LS_PREFIX = "onebiz:pos:retail:cart";
const LS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function lsKey(tenantId: string, branchId: string): string {
  return `${LS_PREFIX}:${LS_VERSION}:${tenantId}:${branchId}`;
}

export interface LocalCartBackup {
  lines: OrderLine[];
  /** Slim shape giống AutoSaveSnapshot — đủ để dựng lại tên hiển thị giỏ. */
  customer: { id: string; name: string } | null;
  orderDiscount: DiscountInput;
  paymentMethod: "cash" | "transfer" | "card" | "mixed";
  note?: string;
  sessionId: string;
  savedAt: number;
}

/** Ghi sync localStorage — best-effort, never throws. */
export function saveLocalCart(
  tenantId: string,
  branchId: string,
  data: Omit<LocalCartBackup, "savedAt">,
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: LocalCartBackup = { ...data, savedAt: Date.now() };
    localStorage.setItem(lsKey(tenantId, branchId), JSON.stringify(payload));
  } catch {
    // localStorage full/disabled — silent fail. DB save sẽ catch up.
  }
}

/** Đọc localStorage. Trả null nếu không có, hết hạn, hoặc parse fail. */
export function loadLocalCart(
  tenantId: string,
  branchId: string,
): LocalCartBackup | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(lsKey(tenantId, branchId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalCartBackup;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > LS_MAX_AGE_MS) {
      // Stale → tự xoá để khỏi chiếm chỗ.
      localStorage.removeItem(lsKey(tenantId, branchId));
      return null;
    }
    if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Xoá localStorage — gọi sau khi checkout thành công hoặc cart trống. */
export function clearLocalCart(tenantId: string, branchId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(lsKey(tenantId, branchId));
  } catch {
    // ignore
  }
}

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
   * Callback khi save thành công — invoiceId của draft trên server.
   * Quan trọng: parent (POS page) dùng để set `state.loadedDraftId` →
   * khi cashier bấm Thanh toán, handleComplete sẽ gọi completeDraftOrder
   * (atomic flip status) thay vì posCheckout (idempotency conflict với
   * draft đã tồn tại). Bug fix CEO 04/05/2026.
   */
  onSaved?: (invoiceId: string) => void;
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
  onSaved,
}: UseAutoSaveDraftArgs): void {
  const debouncedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedHashRef = useRef<string>("");
  const inFlightRef = useRef<boolean>(false);
  // Track invoice ID đã save (từ saveDraftOrder result) để có thể delete khi
  // cart trống. Lần đầu save chưa có id.
  const savedInvoiceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId || !ctx) return;

    // ── 1. localStorage backup IMMEDIATELY (sync, không network) ──
    // F5/cúp điện trong khoảng debounce vẫn cứu được vì LS đã có data.
    if (snapshot.lines.length > 0) {
      saveLocalCart(ctx.tenantId, ctx.branchId, {
        lines: snapshot.lines,
        customer: snapshot.customer,
        orderDiscount: snapshot.orderDiscount,
        paymentMethod: snapshot.paymentMethod,
        note: snapshot.note,
        sessionId,
      });
    } else {
      clearLocalCart(ctx.tenantId, ctx.branchId);
    }

    // Hash state để skip save khi không thay đổi
    const stateHash = computeStateHash(snapshot);

    // Cart rỗng → cleanup draft trên server (nếu đã có)
    if (snapshot.lines.length === 0) {
      if (savedInvoiceIdRef.current && stateHash !== lastSavedHashRef.current) {
        const idToDelete = savedInvoiceIdRef.current;
        savedInvoiceIdRef.current = null;
        lastSavedHashRef.current = stateHash;
        // Best-effort cleanup — không block UI.
        // CEO 16/06/2026 — onlyAutoSaved: CHỈ xoá nháp kỹ thuật (auto_saved=true).
        // Nếu user vừa bấm "Nháp" tay (promote auto_saved=false) rồi clearCart →
        // KHÔNG được xoá nháp đó (trước đây xoá nhầm → F3 trống, mất nháp).
        deleteDraftOrder(idToDelete, { onlyAutoSaved: true }).catch((err) => {
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
        // Notify parent → set state.loadedDraftId để handleComplete đi
        // nhánh completeDraftOrder thay vì posCheckout (tránh dup conflict).
        onSaved?.(result.invoiceId);
      } catch (err) {
        console.warn("[useAutoSaveDraft] save failed:", err);
      } finally {
        inFlightRef.current = false;
      }
    }, 400); // CEO 01/06/2026: giảm từ 1500ms → 400ms để F5 sau ~0.4s đã có draft DB.

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
