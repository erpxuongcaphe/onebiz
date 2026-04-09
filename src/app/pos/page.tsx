"use client";

// ---------------------------------------------------------------------------
// POS Terminal — Keyboard-first entry (Sprint POS Rev 3, 08/04/2026)
//
// - Top bar 40px: nút Quay lại + tiêu đề + ô search SP inline (F2)
// - Body 2 cột: trái = bảng dòng đơn (autocomplete SP, qty, giá, discount),
//                phải = panel khách hàng + tổng tiền + thanh toán
// - Hotkey legend hiển thị inline (footer đen) để truyền tải intent
//
// Hotkeys:
//   F2  — mở modal tìm sản phẩm
//   F4  — mở modal tìm khách hàng
//   F9  — lưu nháp (status=draft, chưa trừ stock)
//   F10 — hoàn tất (status=completed, trừ stock + auto phiếu thu + in bill)
//   Esc — đóng modal đang mở → hoặc quay về trang chủ
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Search,
  PackagePlus,
  Keyboard,
  User,
  UserCheck,
  CreditCard,
  Save,
  CheckCircle2,
  Trash2,
  Loader2,
  Percent,
  DollarSign,
} from "lucide-react";

import {
  posCheckout,
  saveDraftOrder,
  getCurrentContext,
  type PosCheckoutInput,
  type PosCheckoutItem,
} from "@/lib/services/supabase";
import { useToast } from "@/lib/contexts";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { printReceiptDirect, type ReceiptData } from "@/components/shared/print-receipt";

import { usePosState, type OrderLine, type DiscountInput } from "./hooks/use-pos-state";
import { ProductAutocomplete } from "./components/product-autocomplete";
import { CustomerPicker } from "./components/customer-picker";

// ============================================================
// Hotkey legend (footer)
// ============================================================
const HOTKEYS: { key: string; label: string }[] = [
  { key: "F2", label: "Tìm hàng" },
  { key: "F4", label: "Khách hàng" },
  { key: "F9", label: "Lưu nháp" },
  { key: "F10", label: "Thanh toán" },
  { key: "Esc", label: "Thoát" },
  { key: "↑ ↓", label: "Chọn dòng" },
  { key: "Enter", label: "Xác nhận" },
];

// ============================================================
// Page
// ============================================================
export default function PosPage() {
  const router = useRouter();
  const { toast } = useToast();
  const state = usePosState();

  // Modals
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);

  // Submit state — React state for UI + synchronous ref for double-call guard
  const [submitting, setSubmitting] = useState<"draft" | "complete" | null>(null);
  const submitLockRef = useRef(false);

  // Auto-print toggle (persist in localStorage)
  const [autoPrint, setAutoPrint] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("pos.autoPrint");
    if (saved !== null) setAutoPrint(saved === "true");
  }, []);
  const toggleAutoPrint = useCallback(() => {
    setAutoPrint((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("pos.autoPrint", String(next));
      }
      return next;
    });
  }, []);

  const anyModalOpen = productModalOpen || customerModalOpen;

  // ============================================================
  // Build backend payload
  // ============================================================

  const buildCheckoutPayload = useCallback(
    async (paymentOverride?: {
      paid?: number;
      paymentMethod?: PosCheckoutInput["paymentMethod"];
    }): Promise<PosCheckoutInput> => {
      const ctx = await getCurrentContext();

      const items: PosCheckoutItem[] = state.lines.map((l) => {
        const lineTotal = state.computeLineTotal(l);
        const gross = l.quantity * l.unitPrice;
        const lineDiscount = Math.max(0, gross - lineTotal);
        return {
          productId: l.productId,
          productName: l.productName,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: lineDiscount,
        };
      });

      return {
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        createdBy: ctx.userId,
        customerId: state.customer?.id ?? null,
        customerName: state.customer?.name ?? "Khách lẻ",
        items,
        paymentMethod: paymentOverride?.paymentMethod ?? state.paymentMethod,
        subtotal: state.subtotal,
        discountAmount: state.orderDiscountAmount,
        total: state.total,
        paid: paymentOverride?.paid ?? state.paid,
        note: state.note || undefined,
      };
    },
    [state]
  );

  // ============================================================
  // F9 — Save draft
  // ============================================================

  const handleSaveDraft = useCallback(async () => {
    // Double-call guard: useRef is synchronous — prevents race between
    // two rapid F9 presses before React re-renders the disabled button.
    if (submitLockRef.current) return;
    if (state.lines.length === 0) {
      toast({
        title: "Giỏ hàng trống",
        description: "Thêm ít nhất một sản phẩm trước khi lưu nháp",
        variant: "warning",
      });
      return;
    }
    submitLockRef.current = true;
    setSubmitting("draft");
    try {
      const payload = await buildCheckoutPayload({ paid: 0 });
      const result = await saveDraftOrder(payload);
      toast({
        title: `Đã lưu nháp ${result.invoiceCode}`,
        description: `${state.itemCount} sản phẩm · ${formatCurrency(state.total)} ₫`,
        variant: "success",
      });
      state.clearCart();
    } catch (err) {
      toast({
        title: "Lưu nháp thất bại",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      submitLockRef.current = false;
      setSubmitting(null);
    }
  }, [state, buildCheckoutPayload, toast]);

  // ============================================================
  // F10 — Complete sale
  // ============================================================

  const handleComplete = useCallback(async () => {
    // Double-call guard (synchronous ref — prevents duplicate invoices)
    if (submitLockRef.current) return;
    if (state.lines.length === 0) {
      toast({
        title: "Giỏ hàng trống",
        description: "Thêm ít nhất một sản phẩm trước khi thanh toán",
        variant: "warning",
      });
      return;
    }

    // Oversell guard (non-blocking warning already fired on addLine;
    // final total check re-warns if user changed qty afterwards)
    const oversoldLine = state.lines.find(
      (l) => l.availableStock > 0 && l.quantity > l.availableStock
    );
    if (oversoldLine) {
      const ok = window.confirm(
        `Sản phẩm "${oversoldLine.productName}" chỉ còn ${oversoldLine.availableStock} trong kho ` +
          `nhưng đang bán ${oversoldLine.quantity}. Tiếp tục thanh toán (có thể âm kho)?`
      );
      if (!ok) return;
    }

    // Partial payment confirm
    if (state.paid < state.total && state.paymentMethod !== "mixed") {
      const ok = window.confirm(
        `Khách trả thiếu ${formatCurrency(state.total - state.paid)} ₫ ` +
          `(sẽ ghi công nợ). Tiếp tục thanh toán?`
      );
      if (!ok) return;
    }

    submitLockRef.current = true;
    setSubmitting("complete");
    try {
      const payload = await buildCheckoutPayload();
      const result = await posCheckout(payload);

      toast({
        title: `Hoàn tất ${result.invoiceCode}`,
        description: `${formatCurrency(state.total)} ₫ · Đã trừ kho + ghi sổ quỹ`,
        variant: "success",
      });

      // Print receipt (M4.B)
      if (autoPrint) {
        const receiptData: ReceiptData = {
          invoiceCode: result.invoiceCode,
          storeName: "OneBiz POS",
          customerName: state.customer?.name ?? "Khách lẻ",
          items: state.lines.map((l) => {
            const lineTotal = state.computeLineTotal(l);
            const gross = l.quantity * l.unitPrice;
            return {
              name: l.productName,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discount: Math.max(0, gross - lineTotal),
              total: lineTotal,
            };
          }),
          subtotal: state.subtotal,
          discountAmount: state.orderDiscountAmount,
          total: state.total,
          paid: state.paid,
          change: state.change,
          paymentMethod: state.paymentMethod,
          date: new Date().toLocaleString("vi-VN"),
          note: state.note || undefined,
        };
        try {
          printReceiptDirect(receiptData);
        } catch {
          // Printing is best-effort — never block the checkout flow
        }
      }

      state.clearCart();
    } catch (err) {
      toast({
        title: "Thanh toán thất bại",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      submitLockRef.current = false;
      setSubmitting(null);
    }
  }, [state, buildCheckoutPayload, autoPrint, toast]);

  // ============================================================
  // Global hotkey handler
  // ============================================================

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Inside whitelisted inputs we let keys pass through, except the
      // dedicated F-keys which always belong to the terminal.
      const target = e.target as HTMLElement | null;
      const insideAllowedInput =
        target?.tagName === "INPUT" &&
        (target as HTMLInputElement).dataset.allowHotkeys === "true";

      if (e.key === "F2") {
        e.preventDefault();
        setCustomerModalOpen(false);
        setProductModalOpen(true);
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        setProductModalOpen(false);
        setCustomerModalOpen(true);
        return;
      }
      if (e.key === "F9") {
        e.preventDefault();
        if (submitting) return;
        handleSaveDraft();
        return;
      }
      if (e.key === "F10") {
        e.preventDefault();
        if (submitting) return;
        handleComplete();
        return;
      }
      if (e.key === "Escape") {
        // If we're inside a whitelisted modal input the modals handle their
        // own Escape via onKeyDown — don't double-handle.
        if (insideAllowedInput) return;
        if (anyModalOpen) {
          e.preventDefault();
          setProductModalOpen(false);
          setCustomerModalOpen(false);
          return;
        }
        e.preventDefault();
        router.push("/");
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [anyModalOpen, submitting, handleSaveDraft, handleComplete, router]);

  // ============================================================
  // Render
  // ============================================================

  return (
    <>
      {/* ============ Top bar 40px ============ */}
      <header className="h-10 bg-[hsl(217,91%,40%)] text-white flex items-center px-3 shrink-0 gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-sm hover:bg-white/10 transition-colors shrink-0"
          title="Quay lại Quản lý (Esc)"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Quay lại</span>
        </Link>

        <div className="flex items-center gap-2 shrink-0">
          <PackagePlus className="h-4 w-4" />
          <span className="text-sm font-semibold">POS</span>
        </div>

        {/* Click-to-open search */}
        <div className="flex-1 flex items-center gap-2 max-w-2xl mx-auto">
          <button
            type="button"
            onClick={() => setProductModalOpen(true)}
            className="w-full h-7 flex items-center gap-2 pl-3 pr-2 rounded bg-white/15 border border-white/20 text-white/80 hover:bg-white/20 text-sm transition-colors text-left"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate text-white/70">
              Quét mã / nhập tên sản phẩm để thêm dòng...
            </span>
            <kbd className="font-mono text-[10px] bg-white/10 border border-white/20 rounded px-1 py-0.5 shrink-0">
              F2
            </kbd>
          </button>
        </div>

        <div className="hidden md:flex items-center gap-1.5 text-xs text-white/70 shrink-0">
          <Keyboard className="h-3.5 w-3.5" />
          <span>{state.itemCount} SP</span>
          <span className="text-white/40">|</span>
          <span>{formatCurrency(state.total)} ₫</span>
        </div>
      </header>

      {/* ============ Main 2-column body ============ */}
      <div className="flex-1 flex min-h-0 bg-muted/30">
        {/* ----- LEFT: Order line table ----- */}
        <div className="flex-1 flex flex-col bg-white border-r border-border min-w-0">
          {/* Table header */}
          <div className="grid grid-cols-[32px_1fr_90px_130px_140px_130px_32px] gap-2 px-4 py-2 border-b bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
            <div className="text-center">#</div>
            <div>Sản phẩm</div>
            <div className="text-center">SL</div>
            <div className="text-right">Đơn giá</div>
            <div className="text-right">Chiết khấu</div>
            <div className="text-right">Thành tiền</div>
            <div></div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {state.lines.length === 0 ? (
              <EmptyState onOpenSearch={() => setProductModalOpen(true)} />
            ) : (
              state.lines.map((line, idx) => (
                <OrderLineRow
                  key={line.lineId}
                  idx={idx + 1}
                  line={line}
                  computeLineTotal={state.computeLineTotal}
                  onQty={(qty) => state.updateLineQty(line.lineId, qty)}
                  onPrice={(price) => state.updateLinePrice(line.lineId, price)}
                  onDiscount={(d) => state.updateLineDiscount(line.lineId, d)}
                  onRemove={() => state.removeLine(line.lineId)}
                />
              ))
            )}
          </div>

          {/* Hotkey legend strip */}
          <div className="border-t bg-slate-900 text-white px-4 py-2 flex items-center gap-3 overflow-x-auto shrink-0">
            <Keyboard className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {HOTKEYS.map((hk) => (
              <div key={hk.key} className="flex items-center gap-1.5 shrink-0">
                <kbd className="font-mono text-[10px] font-bold bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-white">
                  {hk.key}
                </kbd>
                <span className="text-[11px] text-slate-300">{hk.label}</span>
              </div>
            ))}

            <div className="ml-auto flex items-center gap-2 shrink-0">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoPrint}
                  onChange={toggleAutoPrint}
                  className="h-3 w-3 rounded border-slate-500 bg-slate-700"
                />
                <span>Tự động in bill</span>
              </label>
            </div>
          </div>
        </div>

        {/* ----- RIGHT: Customer + Total + Payment panel ----- */}
        <aside className="w-[360px] bg-white shrink-0 hidden lg:flex flex-col">
          {/* Customer */}
          <div className="p-4 border-b">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Khách hàng
            </div>
            <button
              type="button"
              onClick={() => setCustomerModalOpen(true)}
              className={cn(
                "w-full flex items-center gap-2 px-3 h-9 rounded-md border text-sm transition-colors",
                state.customer
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "border-dashed border-border text-muted-foreground hover:border-primary hover:bg-primary/5"
              )}
            >
              {state.customer ? (
                <UserCheck className="h-4 w-4 text-emerald-600" />
              ) : (
                <User className="h-4 w-4" />
              )}
              <span className="flex-1 text-left truncate">
                {state.customer?.name ?? "Chọn khách hàng"}
              </span>
              <kbd className="font-mono text-[10px] bg-muted border rounded px-1">
                F4
              </kbd>
            </button>
            {state.customer && (
              <button
                type="button"
                onClick={() => state.setCustomer(null)}
                className="mt-1 text-[11px] text-muted-foreground hover:text-red-600 transition-colors"
              >
                Gỡ khách (dùng khách lẻ)
              </button>
            )}
          </div>

          {/* Totals */}
          <div className="p-4 border-b space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Tạm tính</span>
              <span className="font-medium text-foreground">
                {formatCurrency(state.subtotal)} ₫
              </span>
            </div>
            {state.lineDiscountTotal > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Giảm theo dòng</span>
                <span>−{formatCurrency(state.lineDiscountTotal)} ₫</span>
              </div>
            )}

            {/* Order discount input */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-muted-foreground text-xs flex-1">
                Chiết khấu đơn
              </span>
              <DiscountInputField
                value={state.orderDiscount}
                onChange={state.setOrderDiscount}
              />
            </div>
            {state.orderDiscountAmount > 0 && (
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span></span>
                <span>−{formatCurrency(state.orderDiscountAmount)} ₫</span>
              </div>
            )}

            <div className="flex justify-between text-base font-bold pt-2 border-t">
              <span>Khách phải trả</span>
              <span className="text-primary">
                {formatCurrency(state.total)} ₫
              </span>
            </div>
          </div>

          {/* Payment */}
          <div className="p-4 flex-1 flex flex-col gap-3 overflow-y-auto">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Phương thức thanh toán
              </div>
              <div className="grid grid-cols-3 gap-2">
                <PaymentMethodButton
                  label="Tiền mặt"
                  active={state.paymentMethod === "cash"}
                  onClick={() => state.setPaymentMethod("cash")}
                />
                <PaymentMethodButton
                  label="Chuyển khoản"
                  active={state.paymentMethod === "transfer"}
                  onClick={() => state.setPaymentMethod("transfer")}
                />
                <PaymentMethodButton
                  label="Thẻ"
                  active={state.paymentMethod === "card"}
                  onClick={() => state.setPaymentMethod("card")}
                />
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Khách đưa
              </div>
              <input
                type="number"
                inputMode="numeric"
                value={state.paid || ""}
                onChange={(e) =>
                  state.setPaid(Math.max(0, parseInt(e.target.value) || 0))
                }
                placeholder={`${formatCurrency(state.total)}`}
                data-allow-hotkeys="true"
                className="w-full h-10 px-3 rounded-md border border-border text-right text-base font-semibold outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <div className="flex justify-between text-[11px] mt-1.5">
                {state.change > 0 ? (
                  <span className="text-emerald-600 font-medium">
                    Tiền thừa: {formatCurrency(state.change)} ₫
                  </span>
                ) : (
                  <span />
                )}
                {state.debt > 0 && (
                  <span className="text-amber-600 font-medium ml-auto">
                    Còn nợ: {formatCurrency(state.debt)} ₫
                  </span>
                )}
              </div>
              <div className="flex gap-1.5 mt-2">
                <QuickPaidButton
                  label="Đủ"
                  onClick={() => state.setPaid(state.total)}
                />
                <QuickPaidButton
                  label="Xóa"
                  onClick={() => state.setPaid(0)}
                />
              </div>
            </div>

            {/* Note */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Ghi chú
              </div>
              <textarea
                value={state.note}
                onChange={(e) => state.setNote(e.target.value)}
                rows={2}
                data-allow-hotkeys="true"
                className="w-full px-3 py-2 rounded-md border border-border text-sm resize-none outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="Ghi chú cho đơn..."
              />
            </div>
          </div>

          {/* Action buttons (bottom) */}
          <div className="p-4 border-t grid grid-cols-2 gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={state.lines.length === 0 || submitting !== null}
              className="h-11 rounded-md border bg-white text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
            >
              {submitting === "draft" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Lưu nháp
              <kbd className="font-mono text-[9px] bg-muted border rounded px-1 ml-0.5">
                F9
              </kbd>
            </button>
            <button
              type="button"
              onClick={handleComplete}
              disabled={state.lines.length === 0 || submitting !== null}
              className="h-11 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
            >
              {submitting === "complete" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Hoàn tất
              <kbd className="font-mono text-[9px] bg-emerald-700 border border-emerald-500 rounded px-1 ml-0.5">
                F10
              </kbd>
            </button>
          </div>
        </aside>
      </div>

      {/* Modals */}
      <ProductAutocomplete
        open={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        onSelect={(product) => {
          state.addLine(product);
          if (product.stock <= 0) {
            toast({
              title: "Hết hàng",
              description: `Sản phẩm "${product.name}" đã hết trong kho`,
              variant: "warning",
            });
          }
        }}
      />
      <CustomerPicker
        open={customerModalOpen}
        onClose={() => setCustomerModalOpen(false)}
        onSelect={(customer) => state.setCustomer(customer)}
      />
    </>
  );
}

// ============================================================
// Sub-components
// ============================================================

function EmptyState({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <div className="p-12 text-center">
      <div className="h-16 w-16 mx-auto rounded-full bg-blue-100 flex items-center justify-center mb-4">
        <PackagePlus className="h-8 w-8 text-blue-600" />
      </div>
      <h2 className="text-lg font-bold mb-1">Giỏ hàng trống</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
        Nhấn <kbd className="font-mono text-xs bg-slate-100 border rounded px-1.5 py-0.5">F2</kbd>{" "}
        hoặc bấm vào ô search để thêm sản phẩm đầu tiên
      </p>
      <button
        type="button"
        onClick={onOpenSearch}
        className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
      >
        <Search className="h-4 w-4" />
        Tìm sản phẩm
      </button>
    </div>
  );
}

function OrderLineRow({
  idx,
  line,
  computeLineTotal,
  onQty,
  onPrice,
  onDiscount,
  onRemove,
}: {
  idx: number;
  line: OrderLine;
  computeLineTotal: (l: OrderLine) => number;
  onQty: (qty: number) => void;
  onPrice: (price: number) => void;
  onDiscount: (d: DiscountInput) => void;
  onRemove: () => void;
}) {
  const lineTotal = computeLineTotal(line);
  const oversold = line.availableStock > 0 && line.quantity > line.availableStock;

  return (
    <div
      className={cn(
        "grid grid-cols-[32px_1fr_90px_130px_140px_130px_32px] gap-2 px-4 py-2 border-b border-border items-center hover:bg-muted/20",
        oversold && "bg-amber-50"
      )}
    >
      <div className="text-center text-xs text-muted-foreground">{idx}</div>
      <div className="min-w-0">
        <div className="font-mono text-[10px] text-muted-foreground truncate">
          {line.productCode}
        </div>
        <div className="text-sm font-medium truncate">{line.productName}</div>
        {oversold && (
          <div className="text-[10px] text-amber-600">
            Tồn kho còn {line.availableStock} — sẽ âm kho
          </div>
        )}
      </div>
      <input
        type="number"
        min={1}
        value={line.quantity}
        onChange={(e) => onQty(parseInt(e.target.value) || 0)}
        data-allow-hotkeys="true"
        className="h-8 px-2 text-center text-sm rounded border border-border outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      />
      <input
        type="number"
        min={0}
        value={line.unitPrice}
        onChange={(e) => onPrice(parseInt(e.target.value) || 0)}
        data-allow-hotkeys="true"
        className="h-8 px-2 text-right text-sm rounded border border-border outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary tabular-nums"
      />
      <div className="flex justify-end">
        <DiscountInputField value={line.discount} onChange={onDiscount} />
      </div>
      <div className="text-right text-sm font-semibold tabular-nums">
        {formatCurrency(lineTotal)} ₫
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="h-7 w-7 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 flex items-center justify-center transition-colors"
        title="Xoá dòng"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function DiscountInputField({
  value,
  onChange,
}: {
  value: DiscountInput;
  onChange: (d: DiscountInput) => void;
}) {
  return (
    <div className="inline-flex items-stretch h-8 rounded border border-border overflow-hidden">
      <input
        type="number"
        min={0}
        value={value.value || ""}
        onChange={(e) =>
          onChange({ ...value, value: Math.max(0, parseInt(e.target.value) || 0) })
        }
        data-allow-hotkeys="true"
        placeholder="0"
        className="w-16 px-2 text-right text-xs outline-none tabular-nums"
      />
      <button
        type="button"
        onClick={() =>
          onChange({ ...value, mode: value.mode === "amount" ? "percent" : "amount" })
        }
        className={cn(
          "w-7 flex items-center justify-center text-[11px] border-l border-border font-semibold transition-colors",
          value.mode === "percent"
            ? "bg-blue-50 text-blue-700"
            : "bg-slate-50 text-slate-600 hover:bg-slate-100"
        )}
        title={value.mode === "percent" ? "Đang tính theo %" : "Đang tính theo đồng"}
      >
        {value.mode === "percent" ? (
          <Percent className="h-3 w-3" />
        ) : (
          <DollarSign className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}

function PaymentMethodButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 rounded-md border text-xs font-medium transition-colors inline-flex items-center justify-center gap-1",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-white text-muted-foreground hover:bg-muted"
      )}
    >
      <CreditCard className="h-3 w-3" />
      {label}
    </button>
  );
}

function QuickPaidButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 h-7 rounded border border-border bg-white text-xs text-muted-foreground hover:bg-muted transition-colors"
    >
      {label}
    </button>
  );
}
