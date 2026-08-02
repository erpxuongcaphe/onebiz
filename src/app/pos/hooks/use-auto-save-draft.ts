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
import { LatestOnlyAsyncQueue } from "../lib/latest-only-async-queue";

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
    // 28/07: chấp nhận backup CHỈ CÓ KHÁCH (0 dòng hàng) — xem ghi chú ở
    // saveLocalCart. Chỉ coi là rỗng khi không có cả hàng lẫn khách.
    if (!Array.isArray(parsed.lines)) return null;
    if (parsed.lines.length === 0 && !parsed.customer) return null;
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
  shippingFee: number;
  orderVatRate: number;
  note?: string;
  deliveryInfo?: DeliveryInfo;
  computeLineTotal: (l: OrderLine) => number;
}

export interface DraftSaveState {
  invoiceId: string;
  revision: number;
}

export interface DraftSaveConflict {
  code: "POS_DRAFT_CONFLICT" | "POS_DRAFT_SESSION_CHANGED" | "POS_DRAFT_NOT_FOUND" | "POS_DRAFT_CHANGED_DURING_SAVE";
  invoiceId: string | null;
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
  /** Draft currently loaded in the browser, if any. */
  draftId?: string | null;
  draftRevision?: number | null;
  /**
   * Callback khi save thành công — invoiceId của draft trên server.
   * Quan trọng: parent (POS page) dùng để set `state.loadedDraftId` →
   * khi cashier bấm Thanh toán, handleComplete sẽ gọi completeDraftOrder
   * (atomic flip status) thay vì posCheckout (idempotency conflict với
   * draft đã tồn tại). Bug fix CEO 04/05/2026.
   */
  onSaved?: (state: DraftSaveState) => void;
  onConflict?: (conflict: DraftSaveConflict) => void;
}

interface PendingDraftSave {
  sessionId: string;
  snapshot: AutoSaveSnapshot;
  ctx: NonNullable<UseAutoSaveDraftArgs["ctx"]>;
  stateKey: string;
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
  draftId = null,
  draftRevision = null,
  onSaved,
  onConflict,
}: UseAutoSaveDraftArgs): void {
  const debouncedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedKeyRef = useRef<string>("");
  const currentSessionRef = useRef<string | null>(sessionId);
  const hasDraftContentRef = useRef(snapshot.lines.length > 0);
  const onSavedRef = useRef(onSaved);
  const onConflictRef = useRef(onConflict);
  const mountedRef = useRef(true);
  const savedInvoiceIdRef = useRef<string | null>(draftId);
  const savedRevisionRef = useRef<number | null>(draftRevision);
  const serverSessionRef = useRef<string | null>(sessionId);
  const conflictedSessionRef = useRef<string | null>(null);
  const saveQueueRef = useRef<LatestOnlyAsyncQueue<PendingDraftSave> | null>(null);

  currentSessionRef.current = sessionId;
  hasDraftContentRef.current = snapshot.lines.length > 0;
  onSavedRef.current = onSaved;
  onConflictRef.current = onConflict;

  if (serverSessionRef.current !== sessionId) {
    serverSessionRef.current = sessionId;
    savedInvoiceIdRef.current = draftId;
    savedRevisionRef.current = draftRevision;
    conflictedSessionRef.current = null;
  } else if (draftId && (
    savedInvoiceIdRef.current !== draftId ||
    (draftRevision ?? -1) > (savedRevisionRef.current ?? -1)
  )) {
    savedInvoiceIdRef.current = draftId;
    savedRevisionRef.current = draftRevision;
  }

  if (!saveQueueRef.current) {
    saveQueueRef.current = new LatestOnlyAsyncQueue<PendingDraftSave>(
      async (request) => {
        if (conflictedSessionRef.current === request.sessionId) return;
        try {
          const input = buildInput(request.snapshot, request.ctx);
          const result = await saveDraftOrder(input, {
            sessionId: request.sessionId,
            autoSaved: true,
            invoiceId: savedInvoiceIdRef.current,
            expectedRevision: savedRevisionRef.current,
          });
          savedInvoiceIdRef.current = result.invoiceId;
          savedRevisionRef.current = result.revision;
          lastSavedKeyRef.current = request.stateKey;

          // Clean up a save that finished after the user cleared this cart.
          if (
            currentSessionRef.current === request.sessionId &&
            !hasDraftContentRef.current
          ) {
            await deleteDraftOrder(result.invoiceId, { onlyAutoSaved: true });
            savedInvoiceIdRef.current = null;
            savedRevisionRef.current = null;
            return;
          }

          if (
            mountedRef.current &&
            currentSessionRef.current === request.sessionId
          ) {
            onSavedRef.current?.({
              invoiceId: result.invoiceId,
              revision: result.revision,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          const match = message.match(/POS_DRAFT_(CONFLICT|SESSION_CHANGED|NOT_FOUND|CHANGED_DURING_SAVE)/);
          if (match) {
            conflictedSessionRef.current = request.sessionId;
            saveQueueRef.current?.clearPending();
            onConflictRef.current?.({
              code: `POS_DRAFT_${match[1]}` as DraftSaveConflict["code"],
              invoiceId: savedInvoiceIdRef.current,
            });
            return;
          }
          console.warn("[useAutoSaveDraft] save failed:", err);
        }
      },
    );
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveQueueRef.current?.clearPending();
    };
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId || !ctx) return;

    // ── 1. localStorage backup IMMEDIATELY (sync, không network) ──
    // F5/cúp điện trong khoảng debounce vẫn cứu được vì LS đã có data.
    // 28/07: giữ backup cả khi GIỎ TRỐNG nhưng ĐÃ CHỌN KHÁCH. Trước đây giỏ
    // trống là xoá backup → thu ngân chọn khách trước khi thêm hàng (hoặc xoá
    // hết hàng để sửa), tablet idle bị thu hồi bộ nhớ → reload → khách bay về
    // "Khách lẻ". Chỉ xoá khi cả giỏ lẫn khách đều trống.
    if (snapshot.lines.length > 0 || snapshot.customer) {
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
    const stateKey = `${ctx.tenantId}:${ctx.branchId}:${sessionId}:${stateHash}`;

    // Cart rỗng → cleanup draft trên server (nếu đã có)
    if (snapshot.lines.length === 0) {
      if (debouncedRef.current) clearTimeout(debouncedRef.current);
      saveQueueRef.current?.clearPending();
      if (savedInvoiceIdRef.current && stateKey !== lastSavedKeyRef.current) {
        const idToDelete = savedInvoiceIdRef.current;
        savedInvoiceIdRef.current = null;
        savedRevisionRef.current = null;
        lastSavedKeyRef.current = stateKey;
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

    if (stateKey === lastSavedKeyRef.current) return;

    if (debouncedRef.current) clearTimeout(debouncedRef.current);
    debouncedRef.current = setTimeout(() => {
      saveQueueRef.current?.enqueue({ sessionId, snapshot, ctx, stateKey });
    }, 400); // CEO 01/06/2026: giảm từ 1500ms → 400ms để F5 sau ~0.4s đã có draft DB.

    return () => {
      if (debouncedRef.current) clearTimeout(debouncedRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId, JSON.stringify(snapshot.lines), snapshot.customer?.id, snapshot.orderDiscount.value, snapshot.orderDiscount.mode, snapshot.paymentMethod, snapshot.shippingFee, snapshot.orderVatRate, snapshot.note, ctx?.tenantId, ctx?.branchId]);
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
      l.note ?? "", // 00208: gõ ghi chú món cũng phải kích save
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
    variantId: l.variantId ?? null,
    productName: l.variantLabel ? `${l.productName} · ${l.variantLabel}` : l.productName,
    unit: l.unit,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount:
      l.discount.mode === "percent"
        ? Math.round((l.quantity * l.unitPrice * l.discount.value) / 100)
        : l.discount.value,
    vatRate: l.vatRate ?? 0,
    note: l.note, // 00208
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
    orderDiscountAmount: s.orderDiscountAmount,
    shippingFee: s.shippingFee,
    orderVatRate: s.orderVatRate,
    total: s.total,
    paid: 0, // draft luôn paid=0
    note: s.note,
  };
}

