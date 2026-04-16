"use client";

// ---------------------------------------------------------------------------
// POS Terminal — KiotViet-style Retail POS (Redesign v4, 09/04/2026)
//
// Layout: 2 columns
//   LEFT  = Product browsing (category tabs + tile grid + search)
//   RIGHT = Cart panel (customer + items + totals + payment + actions)
//
// Hotkeys:
//   F2  — focus search input
//   F4  — open customer picker modal
//   F9  — save draft (status=draft, no stock change)
//   F10 — checkout (status=completed, stock + cash + print)
//   Esc — close modal or back to home
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Search,
  ShoppingCart,
  User,
  UserCheck,
  CreditCard,
  Banknote,
  Building2,
  Save,
  CheckCircle2,
  Trash2,
  Loader2,
  Minus,
  Plus,
  Package,
  ChevronDown,
  X,
  Keyboard,
  HelpCircle,
  Zap,
  Clock,
  Truck,
  MapPin,
  Phone,
  Layers,
} from "lucide-react";

import {
  posCheckout,
  saveDraftOrder,
  listDraftOrders,
  getDraftOrderById,
  deleteDraftOrder,
  completeDraftOrder,
  getCurrentContext,
  type PosCheckoutInput,
  type PosCheckoutItem,
  type DraftOrderSummary,
  type DraftOrderDetail,
  getProducts,
} from "@/lib/services/supabase";
import { useToast } from "@/lib/contexts";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { printReceiptDirect, type ReceiptData } from "@/components/shared/print-receipt";
import { PosBranchSelector } from "@/components/shared/pos-branch-selector";

import { usePosState, type OrderLine, type DiscountInput, type SellingMode, type DeliveryInfo, type PosSnapshot } from "./hooks/use-pos-state";
import { ProductGrid } from "./components/product-grid";
import { CustomerPicker } from "./components/customer-picker";

// ============================================================
// Constants
// ============================================================
const DENOMINATIONS = [
  { label: "50k", value: 50000 },
  { label: "100k", value: 100000 },
  { label: "200k", value: 200000 },
  { label: "500k", value: 500000 },
  { label: "1M", value: 1000000 },
];

// ============================================================
// Multi-tab types
// ============================================================
interface InvoiceTab {
  id: string;
  label: string;
  /** null = this is the ACTIVE tab (state lives in usePosState) */
  snapshot: PosSnapshot | null;
  itemCount: number;
}

let tabCounter = 0;
function nextTabId() {
  return `tab-${++tabCounter}-${Date.now()}`;
}

// ============================================================
// Page
// ============================================================
export default function PosPage() {
  const router = useRouter();
  const { toast } = useToast();
  const state = usePosState();

  // Multi-tab invoice management (KiotViet parity)
  const [tabs, setTabs] = useState<InvoiceTab[]>(() => [
    { id: nextTabId(), label: "Hoá đơn 1", snapshot: null, itemCount: 0 },
  ]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? "");

  const switchTab = useCallback((tabId: string) => {
    if (tabId === activeTabId) return;
    // Save current state to outgoing tab
    const snapshot = state.getSnapshot();
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, snapshot, itemCount: state.itemCount }
          : t
      )
    );
    // Load incoming tab
    setTabs((prev) => {
      const target = prev.find((t) => t.id === tabId);
      if (target?.snapshot) {
        state.restoreSnapshot(target.snapshot);
        return prev.map((t) =>
          t.id === tabId ? { ...t, snapshot: null } : t
        );
      }
      return prev;
    });
    setActiveTabId(tabId);
  }, [activeTabId, state]);

  const addTab = useCallback(() => {
    // Save current state to old tab
    const snapshot = state.getSnapshot();
    const newId = nextTabId();
    const tabNum = tabs.length + 1;
    setTabs((prev) => [
      ...prev.map((t) =>
        t.id === activeTabId
          ? { ...t, snapshot, itemCount: state.itemCount }
          : t
      ),
      { id: newId, label: `Hoá đơn ${tabNum}`, snapshot: null, itemCount: 0 },
    ]);
    state.clearCart();
    setActiveTabId(newId);
  }, [activeTabId, state, tabs.length]);

  const closeTab = useCallback((tabId: string) => {
    if (tabs.length <= 1) return; // always keep at least 1 tab
    const remaining = tabs.filter((t) => t.id !== tabId);
    if (tabId === activeTabId) {
      // Switch to adjacent tab
      const closedIdx = tabs.findIndex((t) => t.id === tabId);
      const nextTab = remaining[Math.min(closedIdx, remaining.length - 1)];
      if (nextTab.snapshot) {
        state.restoreSnapshot(nextTab.snapshot);
        nextTab.snapshot = null;
      } else {
        state.clearCart();
      }
      setActiveTabId(nextTab.id);
    }
    setTabs(remaining);
  }, [activeTabId, tabs, state]);

  // Modals
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [draftModalOpen, setDraftModalOpen] = useState(false);

  // Search + barcode
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cartScrollRef = useRef<HTMLDivElement>(null);

  // Barcode quick-add: Enter in search → fetch by code → auto-add first match
  const handleSearchEnter = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    try {
      const result = await getProducts({
        page: 0,
        pageSize: 1,
        search: q,
        sortBy: "code",
        sortOrder: "asc",
        filters: { status: "active" },
      });
      if (result.data.length > 0) {
        const product = result.data[0];
        state.addLine(product);
        setSearchQuery("");
        searchInputRef.current?.focus();
        // Auto-scroll cart to bottom
        setTimeout(() => {
          cartScrollRef.current?.scrollTo({ top: cartScrollRef.current.scrollHeight, behavior: "smooth" });
        }, 50);
        if ((product.stock ?? 0) <= 0) {
          toast({ title: "Hết hàng", description: `"${product.name}" đã hết`, variant: "warning" });
        }
      }
    } catch {}
  }, [searchQuery, state, toast]);

  // Note toggle
  const [noteOpen, setNoteOpen] = useState(false);

  // Keyboard shortcut helper
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Mobile/tablet: toggle cart panel visibility (slide-over)
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Submit state — React state for UI + synchronous ref for double-call guard
  const [submitting, setSubmitting] = useState<"draft" | "complete" | null>(null);
  const submitLockRef = useRef(false);

  // Auto-print toggle
  const [autoPrint, setAutoPrint] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("pos.autoPrint");
    if (saved !== null) setAutoPrint(saved === "true");
  }, []);

  // Auto-fill delivery info from customer when customer changes in delivery mode
  useEffect(() => {
    if (state.sellingMode !== "delivery" || !state.customer) return;
    const di = state.deliveryInfo;
    // Only auto-fill if fields are empty (don't overwrite manual edits)
    if (!di.recipientName && !di.recipientPhone) {
      state.setDeliveryInfo({
        ...di,
        recipientName: state.customer.name || "",
        recipientPhone: state.customer.phone || "",
        address: state.customer.address || di.address,
      });
    }
  }, [state.customer?.id, state.sellingMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================
  // Handlers
  // ============================================================

  const handleSaveDraft = useCallback(async () => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting("draft");
    try {
      const ctx = await getCurrentContext();
      if (!ctx) throw new Error("Không xác định được chi nhánh");

      await saveDraftOrder({
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        createdBy: ctx.userId,
        customerId: state.customer?.id ?? null,
        customerName: state.customer?.name ?? "Khách lẻ",
        items: state.lines.map((l) => ({
          productId: l.productId,
          productName: l.productName,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount.mode === "percent"
            ? Math.round((l.quantity * l.unitPrice * l.discount.value) / 100)
            : l.discount.value,
        })),
        paymentMethod: state.paymentMethod,
        subtotal: state.subtotal,
        discountAmount: state.orderDiscountAmount + state.lineDiscountTotal,
        total: state.total,
        paid: 0,
        note: state.note || "",
      });

      toast({ title: "Đã lưu nháp", variant: "success" });
      state.clearCart();
      setMobileCartOpen(false);
    } catch (err: any) {
      toast({ title: "Lưu nháp thất bại", description: err.message, variant: "error" });
    } finally {
      setSubmitting(null);
      submitLockRef.current = false;
    }
  }, [state, toast]);

  const handleComplete = useCallback(async () => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting("complete");
    try {
      const ctx = await getCurrentContext();
      if (!ctx) throw new Error("Không xác định được chi nhánh");

      const paid = state.paid || state.total;
      let invoiceCode: string;

      // Build breakdown for mixed payments
      const breakdown =
        state.paymentMethod === "mixed"
          ? state.paymentBreakdown.filter((b) => b.amount > 0)
          : undefined;

      if (state.loadedDraftId) {
        // ── Completing an existing draft → update in-place (no new invoice) ──
        const result = await completeDraftOrder(state.loadedDraftId, {
          method: state.paymentMethod,
          paid,
          tenantId: ctx.tenantId,
          branchId: ctx.branchId,
          createdBy: ctx.userId,
          paymentBreakdown: breakdown,
        });
        invoiceCode = result.invoiceCode;
      } else {
        // ── Fresh checkout → create new completed invoice ──
        const input: PosCheckoutInput = {
          tenantId: ctx.tenantId,
          branchId: ctx.branchId,
          createdBy: ctx.userId,
          customerId: state.customer?.id ?? null,
          customerName: state.customer?.name ?? "Khách lẻ",
          items: state.lines.map((l) => ({
            productId: l.productId,
            productName: l.productName,
            unit: l.unit,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: l.discount.mode === "percent"
              ? Math.round((l.quantity * l.unitPrice * l.discount.value) / 100)
              : l.discount.value,
            vatRate: l.vatRate ?? 0,
          })),
          paymentMethod: state.paymentMethod,
          paymentBreakdown: breakdown,
          subtotal: state.subtotal,
          discountAmount: state.orderDiscountAmount + state.lineDiscountTotal,
          total: state.total,
          paid,
          note: state.note || "",
        };
        const result = await posCheckout(input);
        invoiceCode = result.invoiceCode;
      }

      if (autoPrint && invoiceCode) {
        try {
          const receipt: ReceiptData = {
            invoiceCode,
            date: new Date().toISOString(),
            customerName: state.customer?.name ?? "Khách lẻ",
            items: state.lines.map((l) => ({
              name: l.productName,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discount: l.discount.mode === "percent"
                ? Math.round((l.quantity * l.unitPrice * l.discount.value) / 100)
                : l.discount.value,
              total: state.computeLineTotal(l),
            })),
            subtotal: state.subtotal,
            discountAmount: state.orderDiscountAmount + state.lineDiscountTotal,
            total: state.total,
            paid,
            change: Math.max(0, paid - state.total),
            paymentMethod: state.paymentMethod,
          };
          printReceiptDirect(receipt);
        } catch {}
      }

      toast({ title: `Hoá đơn ${invoiceCode} thành công!`, variant: "success" });
      state.clearCart();
      setSearchQuery("");
      setMobileCartOpen(false);
    } catch (err: any) {
      toast({ title: "Thanh toán thất bại", description: err.message, variant: "error" });
    } finally {
      setSubmitting(null);
      submitLockRef.current = false;
    }
  }, [state, toast, autoPrint]);

  const handleDebtCheckout = useCallback(async () => {
    if (submitLockRef.current) return;
    if (!state.customer) {
      toast({ title: "Vui lòng chọn khách hàng để ghi nợ", variant: "error" });
      return;
    }
    submitLockRef.current = true;
    setSubmitting("complete");
    try {
      const ctx = await getCurrentContext();
      if (!ctx) throw new Error("Không xác định được chi nhánh");

      const breakdown =
        state.paymentMethod === "mixed"
          ? state.paymentBreakdown.filter((b) => b.amount > 0)
          : undefined;

      const input: PosCheckoutInput = {
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        createdBy: ctx.userId,
        customerId: state.customer.id,
        customerName: state.customer.name,
        items: state.lines.map((l) => ({
          productId: l.productId,
          productName: l.productName,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount.mode === "percent"
            ? Math.round((l.quantity * l.unitPrice * l.discount.value) / 100)
            : l.discount.value,
          vatRate: l.vatRate ?? 0,
        })),
        paymentMethod: state.paymentMethod,
        paymentBreakdown: breakdown,
        subtotal: state.subtotal,
        discountAmount: state.orderDiscountAmount + state.lineDiscountTotal,
        total: state.total,
        paid: 0, // Ghi nợ 100%
        note: state.note ? `[Ghi nợ] ${state.note}` : "[Ghi nợ]",
      };
      const result = await posCheckout(input);

      toast({ title: `Ghi nợ ${result.invoiceCode} thành công!`, variant: "success" });
      state.clearCart();
      setSearchQuery("");
      setMobileCartOpen(false);
    } catch (err: any) {
      toast({ title: "Ghi nợ thất bại", description: err.message, variant: "error" });
    } finally {
      setSubmitting(null);
      submitLockRef.current = false;
    }
  }, [state, toast]);

  // ============================================================
  // Hotkeys
  // ============================================================
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA";
      const allowHotkeys = (e.target as HTMLElement)?.dataset?.allowHotkeys === "true";

      // Tab management hotkeys
      if (e.key === "Tab" && e.ctrlKey) {
        e.preventDefault();
        const curIdx = tabs.findIndex((t) => t.id === activeTabId);
        if (e.shiftKey) {
          // Ctrl+Shift+Tab = prev tab
          const prevIdx = (curIdx - 1 + tabs.length) % tabs.length;
          switchTab(tabs[prevIdx].id);
        } else {
          // Ctrl+Tab = next tab
          const nextIdx = (curIdx + 1) % tabs.length;
          switchTab(tabs[nextIdx].id);
        }
        return;
      }
      if (e.key === "t" && e.ctrlKey) {
        e.preventDefault();
        addTab();
        return;
      }
      if (e.key === "w" && e.ctrlKey && tabs.length > 1) {
        e.preventDefault();
        closeTab(activeTabId);
        return;
      }

      if (e.key === "F2") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        setDraftModalOpen(true);
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        setCustomerModalOpen(true);
        return;
      }
      if (e.key === "F9" && (!inInput || allowHotkeys)) {
        e.preventDefault();
        if (state.lines.length > 0) handleSaveDraft();
        return;
      }
      if (e.key === "F10" && (!inInput || allowHotkeys)) {
        e.preventDefault();
        if (state.lines.length > 0) handleComplete();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (showShortcuts) {
          setShowShortcuts(false);
        } else if (customerModalOpen) {
          setCustomerModalOpen(false);
        } else if (draftModalOpen) {
          setDraftModalOpen(false);
        } else if (mobileCartOpen) {
          setMobileCartOpen(false);
        } else {
          router.push("/");
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    customerModalOpen,
    draftModalOpen,
    showShortcuts,
    mobileCartOpen,
    state.lines.length,
    handleSaveDraft,
    handleComplete,
    router,
    tabs,
    activeTabId,
    switchTab,
    addTab,
    closeTab,
  ]);

  // ============================================================
  // Render
  // ============================================================
  return (
    <>
      {/* Hide number input spinners for clean POS look */}
      <style>{`
        .pos-panel input[type="number"]::-webkit-inner-spin-button,
        .pos-panel input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .pos-panel input[type="number"] { -moz-appearance: textfield; }
      `}</style>

      {/* ═══════════ HEADER 40px ═══════════ */}
      <header className="h-10 bg-blue-700 text-white flex items-center px-3 shrink-0 gap-3">
        {/* Back */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-white/10 transition-colors shrink-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Quay lại</span>
        </Link>

        {/* Branch selector + Title */}
        <PosBranchSelector variant="dark" />
        <div className="h-4 w-px bg-white/20 shrink-0" />
        <div className="flex items-center gap-1.5 shrink-0">
          <ShoppingCart className="h-3.5 w-3.5" />
          <span className="text-[13px] font-bold tracking-wide">POS Retail</span>
        </div>

        {/* Search bar */}
        <div className="flex-1 max-w-lg mx-auto">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/50" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearchEnter();
                }
              }}
              placeholder="Tìm sản phẩm theo tên, mã, barcode..."
              data-allow-hotkeys="true"
              className="w-full h-7 pl-8 pr-14 rounded bg-white/15 border border-white/20 text-white placeholder-white/50 text-xs outline-none focus:bg-white/25 focus:border-white/40 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                className="absolute right-8 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/20"
              >
                <X className="h-3 w-3 text-white/60" />
              </button>
            )}
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] bg-white/10 border border-white/20 rounded px-1 py-0.5 text-white/60">
              F2
            </kbd>
          </div>
        </div>

        {/* Draft button — always visible */}
        <button
          type="button"
          onClick={() => setDraftModalOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-white/70 hover:bg-white/10 hover:text-white transition-colors shrink-0 text-[11px]"
        >
          <Save className="h-3 w-3" />
          <span className="hidden sm:inline">Nháp</span>
          <kbd className="hidden sm:inline font-mono text-[8px] bg-white/10 border border-white/20 rounded px-0.5 text-white/50">F3</kbd>
        </button>

        {/* Stats + Shortcuts — desktop only */}
        <div className="hidden md:flex items-center gap-2 shrink-0 text-[11px]">
          <div className="h-3 w-px bg-white/20" />
          <div className="flex items-center gap-1 text-white/70">
            <ShoppingCart className="h-3 w-3" />
            <span>{state.itemCount} SP</span>
          </div>
          <div className="h-3 w-px bg-white/20" />
          <span className="font-semibold">{formatCurrency(state.total)} ₫</span>
          <div className="h-3 w-px bg-white/20" />
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowShortcuts(!showShortcuts)}
              className="p-1 rounded text-white/50 hover:bg-white/10 hover:text-white transition-colors"
              title="Phím tắt"
            >
              <Keyboard className="h-3.5 w-3.5" />
            </button>
            {showShortcuts && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowShortcuts(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-gray-900 text-white rounded-lg shadow-2xl p-3 w-56 text-[11px]">
                  <div className="font-bold text-xs mb-2 text-white/90 flex items-center gap-1.5">
                    <Keyboard className="h-3.5 w-3.5" />
                    Phím tắt POS
                  </div>
                  <div className="space-y-1.5">
                    {[
                      ["F2", "Tìm sản phẩm"],
                      ["Enter", "Thêm SP (trong ô tìm)"],
                      ["F3", "Mở đơn nháp"],
                      ["F4", "Chọn khách hàng"],
                      ["F9", "Lưu nháp"],
                      ["F10", "Thanh toán"],
                      ["Ctrl+T", "Tạo hoá đơn mới"],
                      ["Ctrl+Tab", "Chuyển hoá đơn"],
                      ["Ctrl+W", "Đóng hoá đơn"],
                      ["Esc", "Đóng popup / Thoát"],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between">
                        <span className="text-white/60">{desc}</span>
                        <kbd className="font-mono text-[9px] bg-white/10 border border-white/20 rounded px-1.5 py-0.5">
                          {key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════ BODY ═══════════ */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Mobile cart backdrop */}
        {mobileCartOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-30 lg:hidden"
            onClick={() => setMobileCartOpen(false)}
          />
        )}

        {/* ─── LEFT: Product Grid ─── */}
        <div className="flex-1 min-w-0">
          <ProductGrid
            searchQuery={searchQuery}
            onAddProduct={(product) => {
              state.addLine(product);
              // Auto-scroll cart to bottom
              setTimeout(() => {
                cartScrollRef.current?.scrollTo({ top: cartScrollRef.current.scrollHeight, behavior: "smooth" });
              }, 50);
              if ((product.stock ?? 0) <= 0) {
                toast({
                  title: "Hết hàng",
                  description: `"${product.name}" đã hết trong kho`,
                  variant: "warning",
                });
              }
            }}
          />
        </div>

        {/* ─── RIGHT: Cart + Payment Panel ─── */}
        <aside className={cn(
          "pos-panel bg-white flex flex-col",
          // Desktop: inline fixed-width panel
          "lg:w-[380px] lg:shrink-0 lg:border-l lg:border-gray-200 lg:static lg:translate-x-0 lg:z-auto lg:shadow-none",
          // Mobile/Tablet: slide-over from right
          "fixed inset-y-0 right-0 z-40 w-full sm:w-[400px] shadow-2xl",
          "transition-transform duration-300 ease-in-out",
          mobileCartOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        )}>
          {/* ── Invoice tabs bar — KiotViet multi-tab ── */}
          <div className="flex items-center bg-gray-50 border-b border-gray-200 shrink-0 min-h-[32px]">
            {/* Mobile back button */}
            <button
              type="button"
              onClick={() => setMobileCartOpen(false)}
              className="lg:hidden shrink-0 h-8 w-8 flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors border-r border-gray-200"
              title="Quay lại sản phẩm"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex-1 flex items-center overflow-x-auto scrollbar-none">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                const count = isActive ? state.itemCount : tab.itemCount;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => switchTab(tab.id)}
                    className={cn(
                      "relative group inline-flex items-center gap-1 px-3 h-8 text-[11px] font-medium whitespace-nowrap transition-all border-b-2 shrink-0",
                      isActive
                        ? "bg-white text-blue-700 border-blue-600"
                        : "text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100"
                    )}
                  >
                    {tab.label}
                    {count > 0 && (
                      <span className={cn(
                        "inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full text-[9px] font-bold",
                        isActive ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-500"
                      )}>
                        {count}
                      </span>
                    )}
                    {/* Close tab button */}
                    {tabs.length > 1 && (
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.id);
                        }}
                        className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-500 text-gray-400 transition-all"
                      >
                        <X className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Add new tab button */}
            <button
              type="button"
              onClick={addTab}
              className="shrink-0 h-8 w-8 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors border-l border-gray-200"
              title="Tạo hoá đơn mới"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* ── Draft indicator (when loaded from F3) ── */}
          {state.loadedDraftId && (
            <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 border-b border-amber-200 text-[11px]">
              <Save className="h-3 w-3 text-amber-600" />
              <span className="text-amber-700 font-medium">Đang sửa nháp</span>
              <button
                type="button"
                onClick={() => {
                  state.clearCart();
                  toast({ title: "Đã huỷ sửa nháp", variant: "success" });
                }}
                className="ml-auto text-amber-500 hover:text-amber-700 text-[10px] underline"
              >
                Huỷ
              </button>
            </div>
          )}

          {/* ── Customer picker row ── */}
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCustomerModalOpen(true)}
                className={cn(
                  "flex-1 flex items-center gap-2 px-2.5 h-8 rounded border text-xs transition-colors",
                  state.customer
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:bg-blue-50/50"
                )}
              >
                {state.customer ? (
                  <UserCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                ) : (
                  <User className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="flex-1 text-left truncate font-medium">
                  {state.customer?.name ?? "Khách lẻ"}
                </span>
                <kbd className="font-mono text-[9px] bg-gray-100 border border-gray-200 rounded px-1 py-0.5 text-gray-400 shrink-0">
                  F4
                </kbd>
              </button>
              {state.customer && (
                <button
                  type="button"
                  onClick={() => state.setCustomer(null)}
                  className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Gỡ khách"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Customer info strip — show phone + debt when selected */}
            {state.customer && (
              <div className="flex items-center gap-3 mt-1 px-1 text-[10px] text-gray-500">
                {state.customer.phone && (
                  <span className="flex items-center gap-0.5">
                    <Phone className="h-2.5 w-2.5" />
                    {state.customer.phone}
                  </span>
                )}
                {(state.customer.currentDebt ?? 0) > 0 && (
                  <span className="flex items-center gap-0.5 text-red-500 font-medium">
                    Nợ cũ: {formatCurrency(state.customer.currentDebt ?? 0)}
                  </span>
                )}
                {state.customer.code && (
                  <span className="text-gray-400 font-mono">{state.customer.code}</span>
                )}
              </div>
            )}
          </div>

          {/* ── Delivery form (Bán giao hàng mode) ── */}
          {state.sellingMode === "delivery" && (
            <DeliveryForm
              value={state.deliveryInfo}
              onChange={state.setDeliveryInfo}
            />
          )}

          {/* ── Cart table header ── */}
          {state.lines.length > 0 && (
            <div className="flex items-center border-b border-gray-200 bg-gray-50 shrink-0">
              <div className="flex-1 grid grid-cols-[20px_1fr_66px_44px_60px_66px_18px] gap-0 px-2 py-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wider items-center">
                <span className="text-center">#</span>
                <span>Tên hàng</span>
                <span className="text-right">Đơn giá</span>
                <span className="text-center">SL</span>
                <span className="text-right">Giảm giá</span>
                <span className="text-right">T.Tiền</span>
                <span />
              </div>
              {/* Clear all button */}
              <button
                type="button"
                onClick={() => {
                  state.clearCart();
                  toast({ title: "Đã xoá giỏ hàng", variant: "success" });
                }}
                className="shrink-0 px-1.5 py-0.5 mr-1 rounded text-[9px] text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Xoá tất cả"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* ── Cart items list ── */}
          <div ref={cartScrollRef} className="flex-1 overflow-y-auto min-h-0">
            {state.lines.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 px-6">
                <ShoppingCart className="h-8 w-8 mb-2 text-gray-200" />
                <p className="text-xs font-medium text-gray-400">Giỏ hàng trống</p>
                <p className="text-[10px] text-gray-300 mt-0.5 text-center">
                  Chọn sản phẩm bên trái hoặc nhấn F2 để tìm
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {state.lines.map((line, idx) => (
                  <CartItem
                    key={line.lineId}
                    index={idx + 1}
                    line={line}
                    lineTotal={state.computeLineTotal(line)}
                    onQtyChange={(qty) => state.updateLineQty(line.lineId, qty)}
                    onPriceChange={(price) => state.updateLinePrice(line.lineId, price)}
                    onDiscountChange={(d) => state.updateLineDiscount(line.lineId, d)}
                    onRemove={() => state.removeLine(line.lineId)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Totals section ── */}
          <div className="border-t border-gray-200 px-3 py-2 space-y-1 bg-gray-50/50">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Tổng tiền hàng ({state.itemCount} SP)</span>
              <span className="font-medium text-gray-700 tabular-nums">
                {formatCurrency(state.subtotal)}
              </span>
            </div>

            {/* Giảm giá — always visible like KiotViet */}
            <div className="flex justify-between text-xs text-gray-500">
              <span>Giảm giá</span>
              <span className={cn("tabular-nums", (state.lineDiscountTotal + state.orderDiscountAmount) > 0 && "text-orange-500")}>
                {(state.lineDiscountTotal + state.orderDiscountAmount) > 0
                  ? `−${formatCurrency(state.lineDiscountTotal + state.orderDiscountAmount)}`
                  : "0"
                }
              </span>
            </div>

            {/* Order discount — hidden in fast mode */}
            {state.sellingMode !== "fast" && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Chiết khấu đơn</span>
                <OrderDiscountInput
                  value={state.orderDiscount}
                  onChange={state.setOrderDiscount}
                />
              </div>
            )}

            {/* Shipping fee */}
            {state.sellingMode === "delivery" && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Phí giao hàng</span>
                <span className="tabular-nums">
                  {state.shippingFee > 0 ? `+${formatCurrency(state.shippingFee)}` : "0"}
                </span>
              </div>
            )}

            {/* VAT */}
            {state.taxAmount > 0 && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Thuế GTGT</span>
                <span className="tabular-nums">
                  +{formatCurrency(state.taxAmount)}
                </span>
              </div>
            )}

            {/* Total */}
            <div className="flex justify-between items-baseline pt-1.5 border-t border-gray-200">
              <span className="text-sm font-bold text-gray-800">Khách cần trả</span>
              <span className="text-base font-bold text-blue-600 tabular-nums">
                {formatCurrency(state.total)} ₫
              </span>
            </div>
          </div>

          {/* ── Payment section (hidden in fast mode) ── */}
          {state.sellingMode !== "fast" && (
            <div className="border-t border-gray-200 px-3 py-2 space-y-2">
              {/* Payment method */}
              <div className="grid grid-cols-4 gap-1.5">
                <PaymentBtn
                  icon={<Banknote className="h-3.5 w-3.5" />}
                  label="Tiền mặt"
                  active={state.paymentMethod === "cash"}
                  onClick={() => state.setPaymentMethod("cash")}
                />
                <PaymentBtn
                  icon={<Building2 className="h-3.5 w-3.5" />}
                  label="CK"
                  active={state.paymentMethod === "transfer"}
                  onClick={() => state.setPaymentMethod("transfer")}
                />
                <PaymentBtn
                  icon={<CreditCard className="h-3.5 w-3.5" />}
                  label="Thẻ"
                  active={state.paymentMethod === "card"}
                  onClick={() => state.setPaymentMethod("card")}
                />
                <PaymentBtn
                  icon={<Layers className="h-3.5 w-3.5" />}
                  label="Hỗn hợp"
                  active={state.paymentMethod === "mixed"}
                  onClick={() => state.setPaymentMethod("mixed")}
                />
              </div>

              {/* Mixed payment breakdown */}
              {state.paymentMethod === "mixed" ? (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                    Chi tiết thanh toán
                  </label>
                  {([
                    { method: "cash" as const, label: "Tiền mặt", icon: <Banknote className="h-3 w-3 text-green-600" /> },
                    { method: "transfer" as const, label: "Chuyển khoản", icon: <Building2 className="h-3 w-3 text-blue-600" /> },
                    { method: "card" as const, label: "Thẻ", icon: <CreditCard className="h-3 w-3 text-purple-600" /> },
                  ]).map((pm) => {
                    const item = state.paymentBreakdown.find((b) => b.method === pm.method);
                    return (
                      <div key={pm.method} className="flex items-center gap-2">
                        <div className="flex items-center gap-1 w-20 shrink-0">
                          {pm.icon}
                          <span className="text-[10px] text-gray-600">{pm.label}</span>
                        </div>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={item?.amount || ""}
                          onChange={(e) =>
                            state.updateBreakdownAmount(
                              pm.method,
                              Math.max(0, parseInt(e.target.value) || 0)
                            )
                          }
                          placeholder="0"
                          data-allow-hotkeys="true"
                          className="flex-1 h-7 px-2 rounded border border-gray-300 text-right text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 tabular-nums"
                        />
                      </div>
                    );
                  })}
                  {/* Breakdown summary */}
                  <div className="flex items-center justify-between pt-1 border-t border-dashed border-gray-200">
                    <span className="text-[10px] text-gray-500">Tổng đã nhập</span>
                    <span
                      className={cn(
                        "text-xs font-bold tabular-nums",
                        state.breakdownTotal >= state.total
                          ? "text-emerald-600"
                          : "text-amber-600"
                      )}
                    >
                      {formatCurrency(state.breakdownTotal)} / {formatCurrency(state.total)} ₫
                    </span>
                  </div>
                  {state.breakdownTotal > 0 && state.breakdownTotal < state.total && (
                    <p className="text-[10px] text-amber-600">
                      Còn thiếu {formatCurrency(state.total - state.breakdownTotal)} ₫
                    </p>
                  )}
                  {state.breakdownTotal > state.total && (
                    <p className="text-[10px] text-emerald-600">
                      Thừa {formatCurrency(state.breakdownTotal - state.total)} ₫
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {/* Single-method: Paid amount */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Khách đưa
                      </label>
                      {state.paid > 0 && state.change > 0 && (
                        <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                          Thừa: {formatCurrency(state.change)} ₫
                        </span>
                      )}
                      {state.paid > 0 && state.debt > 0 && (
                        <span className="text-[11px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                          Nợ: {formatCurrency(state.debt)} ₫
                        </span>
                      )}
                    </div>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={state.paid || ""}
                      onChange={(e) =>
                        state.setPaid(Math.max(0, parseInt(e.target.value) || 0))
                      }
                      placeholder={formatCurrency(state.total)}
                      data-allow-hotkeys="true"
                      className={cn(
                        "w-full h-9 px-3 rounded border text-right text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 tabular-nums transition-colors",
                        state.paid > 0 && state.paid >= state.total
                          ? "border-emerald-400 bg-emerald-50/50"
                          : state.paid > 0 && state.paid < state.total
                          ? "border-amber-400 bg-amber-50/50"
                          : "border-gray-300"
                      )}
                    />
                  </div>

                  {/* Denomination buttons */}
                  <div className="flex gap-1">
                    {DENOMINATIONS.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => state.setPaid(d.value)}
                        className="flex-1 h-7 rounded border border-gray-200 bg-gray-50 text-[10px] font-medium text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors"
                      >
                        {d.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => state.setPaid(state.total)}
                      className="flex-1 h-7 rounded border border-blue-200 bg-blue-50 text-[10px] font-bold text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      Đủ
                    </button>
                  </div>
                </>
              )}

              {/* Note toggle + auto print — inline */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setNoteOpen(!noteOpen)}
                  className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <ChevronDown
                    className={cn(
                      "h-2.5 w-2.5 transition-transform",
                      noteOpen && "rotate-180"
                    )}
                  />
                  Ghi chú
                </button>
                <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoPrint}
                    onChange={() => {
                      const next = !autoPrint;
                      setAutoPrint(next);
                      localStorage.setItem("pos.autoPrint", String(next));
                    }}
                    className="h-3 w-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  In bill
                </label>
              </div>
              {noteOpen && (
                <textarea
                  value={state.note}
                  onChange={(e) => state.setNote(e.target.value)}
                  rows={2}
                  data-allow-hotkeys="true"
                  className="w-full px-2.5 py-1.5 rounded border border-gray-200 text-xs resize-none outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  placeholder="Ghi chú cho đơn hàng..."
                />
              )}
            </div>
          )}

          {/* ── Action buttons ── */}
          <div className={cn(
            "px-3 py-2 border-t border-gray-200 shrink-0 bg-white",
            state.sellingMode === "fast"
              ? "flex flex-col gap-1.5"
              : "grid grid-cols-[1fr_1fr_2fr] gap-1.5"
          )}>
            {/* Draft button */}
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={state.lines.length === 0 || submitting !== null}
              className={cn(
                "rounded border border-gray-300 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1 transition-colors",
                state.sellingMode === "fast" ? "h-8" : "h-10"
              )}
            >
              {submitting === "draft" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Nháp
              <kbd className="font-mono text-[8px] bg-gray-100 border border-gray-200 rounded px-0.5 text-gray-400">
                F9
              </kbd>
            </button>
            {/* Debt button — ghi nợ 100% */}
            <button
              type="button"
              onClick={handleDebtCheckout}
              disabled={state.lines.length === 0 || submitting !== null || !state.customer}
              title={!state.customer ? "Chọn khách hàng để ghi nợ" : "Ghi nợ toàn bộ"}
              className={cn(
                "rounded border border-amber-400 bg-amber-50 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1 transition-colors",
                state.sellingMode === "fast" ? "h-8" : "h-10"
              )}
            >
              <CreditCard className="h-3.5 w-3.5" />
              Ghi nợ
            </button>
            {/* Checkout button — prominent in fast mode */}
            <button
              type="button"
              onClick={handleComplete}
              disabled={state.lines.length === 0 || submitting !== null}
              className={cn(
                "rounded bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 transition-colors shadow-sm",
                state.sellingMode === "fast"
                  ? "h-12 text-base"
                  : "h-10 text-[13px]"
              )}
            >
              {submitting === "complete" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Thanh toán
              <kbd className={cn(
                "font-mono bg-green-700 border border-green-500 rounded px-1 py-0.5",
                state.sellingMode === "fast" ? "text-[10px]" : "text-[9px]"
              )}>
                F10
              </kbd>
            </button>
          </div>
        </aside>
      </div>

      {/* ═══════════ FLOATING CART BUTTON — mobile/tablet only ═══════════ */}
      {!mobileCartOpen && (
        <button
          type="button"
          onClick={() => setMobileCartOpen(true)}
          className={cn(
            "lg:hidden fixed z-30 left-4 right-4 rounded-xl shadow-lg",
            "flex items-center justify-between px-4 active:scale-[0.98] transition-all",
            state.lines.length > 0
              ? "bottom-12 h-12 bg-blue-600 text-white"
              : "bottom-12 h-10 bg-white/95 backdrop-blur border border-gray-200 text-gray-600"
          )}
        >
          <div className="flex items-center gap-2">
            <div className="relative">
              <ShoppingCart className="h-5 w-5" />
              {state.itemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5">
                  {state.itemCount}
                </span>
              )}
            </div>
            <span className="font-semibold text-sm">
              {state.lines.length > 0 ? `${state.itemCount} sản phẩm` : "Xem giỏ hàng"}
            </span>
          </div>
          {state.lines.length > 0 && (
            <span className="font-bold text-sm tabular-nums">{formatCurrency(state.total)} ₫</span>
          )}
        </button>
      )}

      {/* ═══════════ SELLING MODE TABS (bottom bar) ═══════════ */}
      <div className="h-8 bg-white border-t border-gray-200 flex items-stretch px-3 gap-0 shrink-0">
        <SellingModeTab
          icon={<Zap className="h-3 w-3" />}
          label="Bán nhanh"
          active={state.sellingMode === "fast"}
          onClick={() => state.setSellingMode("fast")}
        />
        <SellingModeTab
          icon={<Clock className="h-3 w-3" />}
          label="Bán thường"
          active={state.sellingMode === "normal"}
          onClick={() => state.setSellingMode("normal")}
        />
        <SellingModeTab
          icon={<Truck className="h-3 w-3" />}
          label="Bán giao hàng"
          active={state.sellingMode === "delivery"}
          onClick={() => state.setSellingMode("delivery")}
        />
      </div>

      {/* ═══════════ MODALS ═══════════ */}
      <CustomerPicker
        open={customerModalOpen}
        onClose={() => setCustomerModalOpen(false)}
        onSelect={(customer) => state.setCustomer(customer)}
      />
      <DraftListModal
        open={draftModalOpen}
        onClose={() => setDraftModalOpen(false)}
        onLoad={(draft) => {
          state.loadDraft(draft);
          setDraftModalOpen(false);
          toast({ title: `Đã tải nháp ${draft.code || ""}`, variant: "success" });
        }}
      />
    </>
  );
}

// ============================================================
// Sub-components
// ============================================================

/** Cart item row — KiotViet table style with line #, unit, editable price + discount */
function CartItem({
  index,
  line,
  lineTotal,
  onQtyChange,
  onPriceChange,
  onDiscountChange,
  onRemove,
}: {
  index: number;
  line: OrderLine;
  lineTotal: number;
  onQtyChange: (qty: number) => void;
  onPriceChange: (price: number) => void;
  onDiscountChange: (d: DiscountInput) => void;
  onRemove: () => void;
}) {
  const oversold = line.availableStock > 0 && line.quantity > line.availableStock;

  return (
    <div
      className={cn(
        "grid grid-cols-[20px_1fr_66px_44px_60px_66px_18px] gap-0 px-2 py-1.5 hover:bg-blue-50/30 transition-colors group items-center",
        oversold && "bg-amber-50/40"
      )}
    >
      {/* Line number */}
      <span className="text-[10px] text-gray-400 text-center tabular-nums">{index}</span>

      {/* Name + code + unit */}
      <div className="min-w-0 pr-1">
        <p className="text-[11px] font-medium text-gray-800 truncate leading-tight">
          {line.productName}
        </p>
        <p className="text-[9px] text-gray-400 font-mono truncate leading-tight">
          {line.productCode && <span>{line.productCode}</span>}
          {line.unit && (
            <span className="text-gray-400 ml-1">({line.unit})</span>
          )}
          {oversold && (
            <span className="text-amber-600 ml-1">Tồn: {line.availableStock}</span>
          )}
        </p>
      </div>

      {/* Editable unit price */}
      <input
        type="number"
        min={0}
        value={line.unitPrice || ""}
        onChange={(e) => onPriceChange(parseInt(e.target.value) || 0)}
        data-allow-hotkeys="true"
        className="h-6 w-full px-1 text-right text-[10px] font-medium tabular-nums outline-none bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:bg-white rounded transition-colors"
      />

      {/* Qty */}
      <div className="flex items-center justify-center">
        <input
          type="number"
          min={1}
          value={line.quantity}
          onChange={(e) => onQtyChange(parseInt(e.target.value) || 1)}
          data-allow-hotkeys="true"
          className="h-6 w-10 text-center text-[11px] font-semibold tabular-nums outline-none bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:bg-white rounded transition-colors"
        />
      </div>

      {/* Inline discount — editable with mode toggle */}
      <div className="flex items-center justify-end gap-0">
        <input
          type="number"
          min={0}
          value={line.discount.value || ""}
          onChange={(e) =>
            onDiscountChange({ ...line.discount, value: Math.max(0, parseInt(e.target.value) || 0) })
          }
          data-allow-hotkeys="true"
          placeholder="0"
          className="h-6 w-10 px-0.5 text-right text-[10px] tabular-nums outline-none bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:bg-white rounded-l transition-colors"
        />
        <button
          type="button"
          onClick={() =>
            onDiscountChange({
              ...line.discount,
              mode: line.discount.mode === "amount" ? "percent" : "amount",
            })
          }
          className={cn(
            "h-6 w-5 flex items-center justify-center text-[9px] font-bold border rounded-r transition-colors shrink-0",
            line.discount.mode === "percent"
              ? "bg-blue-50 text-blue-600 border-blue-200"
              : "bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100"
          )}
        >
          {line.discount.mode === "percent" ? "%" : "₫"}
        </button>
      </div>

      {/* Line total */}
      <div className="text-right">
        <span className="text-[11px] font-bold text-gray-800 tabular-nums">
          {formatCurrency(lineTotal)}
        </span>
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={onRemove}
        className="p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all justify-self-center"
        title="Xóa"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Order-level discount input — compact */
function OrderDiscountInput({
  value,
  onChange,
}: {
  value: DiscountInput;
  onChange: (d: DiscountInput) => void;
}) {
  return (
    <div className="inline-flex items-stretch h-6 rounded border border-gray-200 overflow-hidden bg-white">
      <input
        type="number"
        min={0}
        value={value.value || ""}
        onChange={(e) =>
          onChange({ ...value, value: Math.max(0, parseInt(e.target.value) || 0) })
        }
        data-allow-hotkeys="true"
        placeholder="0"
        className="w-12 px-1.5 text-right text-[10px] outline-none tabular-nums"
      />
      <button
        type="button"
        onClick={() =>
          onChange({
            ...value,
            mode: value.mode === "amount" ? "percent" : "amount",
          })
        }
        className={cn(
          "w-6 flex items-center justify-center text-[10px] border-l border-gray-200 font-bold transition-colors",
          value.mode === "percent"
            ? "bg-blue-50 text-blue-600"
            : "bg-gray-50 text-gray-500 hover:bg-gray-100"
        )}
      >
        {value.mode === "percent" ? "%" : "₫"}
      </button>
    </div>
  );
}

/** Payment method button */
function PaymentBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded border text-[10px] font-medium transition-all inline-flex items-center justify-center gap-1",
        active
          ? "border-blue-500 bg-blue-600 text-white shadow-sm"
          : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:border-gray-300"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Selling mode tab — bottom bar, KiotViet underline style */
function SellingModeTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center gap-1.5 px-4 text-[11px] font-medium transition-all",
        active
          ? "text-blue-600"
          : "text-gray-500 hover:text-gray-700"
      )}
    >
      {icon}
      {label}
      {/* Active underline indicator */}
      {active && (
        <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-blue-600 rounded-t" />
      )}
    </button>
  );
}

/** Delivery form — shown when selling mode is "delivery" */
function DeliveryForm({
  value,
  onChange,
}: {
  value: DeliveryInfo;
  onChange: (d: DeliveryInfo) => void;
}) {
  const update = (field: keyof DeliveryInfo, val: string | number | boolean) =>
    onChange({ ...value, [field]: val });

  return (
    <div className="border-b border-gray-200 bg-orange-50/30 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-orange-700">
        <Truck className="h-3 w-3" />
        Thông tin giao hàng
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="relative">
          <input
            type="text"
            value={value.recipientName}
            onChange={(e) => update("recipientName", e.target.value)}
            placeholder="Tên người nhận"
            data-allow-hotkeys="true"
            className="w-full h-7 px-2 pl-7 rounded border border-gray-200 text-[11px] outline-none focus:border-blue-400 bg-white"
          />
          <User className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
        </div>
        <div className="relative">
          <input
            type="tel"
            value={value.recipientPhone}
            onChange={(e) => update("recipientPhone", e.target.value)}
            placeholder="Số điện thoại"
            data-allow-hotkeys="true"
            className="w-full h-7 px-2 pl-7 rounded border border-gray-200 text-[11px] outline-none focus:border-blue-400 bg-white"
          />
          <Phone className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
        </div>
      </div>
      <div className="relative">
        <input
          type="text"
          value={value.address}
          onChange={(e) => update("address", e.target.value)}
          placeholder="Địa chỉ giao hàng (số nhà, đường, phường/xã)"
          data-allow-hotkeys="true"
          className="w-full h-7 px-2 pl-7 rounded border border-gray-200 text-[11px] outline-none focus:border-blue-400 bg-white"
        />
        <MapPin className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <input
          type="text"
          value={value.district}
          onChange={(e) => update("district", e.target.value)}
          placeholder="Khu vực / Quận"
          data-allow-hotkeys="true"
          className="w-full h-7 px-2 rounded border border-gray-200 text-[11px] outline-none focus:border-blue-400 bg-white"
        />
        <input
          type="text"
          value={value.ward}
          onChange={(e) => update("ward", e.target.value)}
          placeholder="Phường / Xã"
          data-allow-hotkeys="true"
          className="w-full h-7 px-2 rounded border border-gray-200 text-[11px] outline-none focus:border-blue-400 bg-white"
        />
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <input
            type="number"
            min={0}
            value={value.shippingFee || ""}
            onChange={(e) => update("shippingFee", Math.max(0, parseInt(e.target.value) || 0))}
            placeholder="Phí giao hàng"
            data-allow-hotkeys="true"
            className="w-full h-7 px-2 rounded border border-gray-200 text-[11px] outline-none focus:border-blue-400 bg-white tabular-nums"
          />
        </div>
        <label className="flex items-center gap-1 text-[10px] text-gray-600 whitespace-nowrap cursor-pointer select-none">
          <input
            type="checkbox"
            checked={value.codEnabled}
            onChange={(e) => update("codEnabled", e.target.checked)}
            className="h-3 w-3 rounded border-gray-300 text-blue-600"
          />
          COD
        </label>
      </div>
      <input
        type="text"
        value={value.deliveryNote}
        onChange={(e) => update("deliveryNote", e.target.value)}
        placeholder="Ghi chú cho bưu tá..."
        data-allow-hotkeys="true"
        className="w-full h-7 px-2 rounded border border-gray-200 text-[11px] outline-none focus:border-blue-400 bg-white"
      />
    </div>
  );
}

/** Draft list modal — load saved drafts (F3) */
function DraftListModal({
  open,
  onClose,
  onLoad,
}: {
  open: boolean;
  onClose: () => void;
  onLoad: (draft: DraftOrderDetail) => void;
}) {
  const [drafts, setDrafts] = useState<DraftOrderSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch drafts when modal opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listDraftOrders()
      .then(setDrafts)
      .catch(() => setDrafts([]))
      .finally(() => setLoading(false));
  }, [open]);

  const handleLoad = useCallback(
    async (id: string) => {
      try {
        const detail = await getDraftOrderById(id);
        if (detail) onLoad(detail);
      } catch (err: any) {
        toast({ title: "Tải nháp thất bại", description: err.message, variant: "error" });
      }
    },
    [onLoad, toast]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(id);
      try {
        await deleteDraftOrder(id);
        setDrafts((prev) => prev.filter((d) => d.id !== id));
        toast({ title: "Đã xóa nháp", variant: "success" });
      } catch (err: any) {
        toast({ title: "Xóa thất bại", description: err.message, variant: "error" });
      } finally {
        setDeleting(null);
      }
    },
    [toast]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-2xl border w-full max-w-lg max-h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Save className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-bold text-gray-800">Đơn nháp đã lưu</h2>
            <kbd className="font-mono text-[9px] bg-gray-100 border border-gray-200 rounded px-1 py-0.5 text-gray-400">
              F3
            </kbd>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            </div>
          ) : drafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Save className="h-8 w-8 mb-2 text-gray-200" />
              <p className="text-xs">Chưa có đơn nháp nào</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50/50 transition-colors group"
                >
                  {/* Draft info */}
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleLoad(draft.id)}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-blue-600">{draft.code}</span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(draft.createdAt).toLocaleString("vi-VN", {
                          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-gray-600 truncate">
                        {draft.customerName || "Khách lẻ"}
                      </span>
                      <span className="text-[10px] text-gray-400">·</span>
                      <span className="text-[10px] text-gray-400">
                        {draft.itemCount} SP
                      </span>
                    </div>
                    {draft.note && (
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">{draft.note}</p>
                    )}
                  </div>

                  {/* Total */}
                  <div className="text-right shrink-0">
                    <span className="text-xs font-bold text-gray-800 tabular-nums">
                      {formatCurrency(draft.total)}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleLoad(draft.id)}
                      className="px-2 py-1 rounded text-[10px] font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      Tải
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(draft.id)}
                      disabled={deleting === draft.id}
                      className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                      title="Xóa nháp"
                    >
                      {deleting === draft.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
