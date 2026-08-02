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
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PermissionPage } from "@/components/shared/permission-page";
import { PERMISSIONS } from "@/lib/permissions";
import {
  saveDraftOrder,
  listDraftOrders,
  getDraftOrderById,
  getOrders,
  adoptDraftSession,
  deleteDraftOrder,
  completeDraftOrder,
  findDraftIdBySession,
  getCurrentContext,
  type PosCheckoutInput,
  type PosCheckoutItem,
  type DraftOrderSummary,
  type DraftOrderDetail,
  getProducts,
  getOrCreateWalkInCustomer,
  getCustomerById,
  attachDeliveryToInvoice,
  getTenantBusinessInfo,
  getInvoiceById,
  getInvoiceItems,
  type TenantBusinessInfo,
} from "@/lib/services/supabase";
import { useAutoSaveDraft, loadLocalCart } from "./hooks/use-auto-save-draft";
import { RecoveryDialog } from "./components/recovery-dialog";
import { getClient } from "@/lib/services/supabase/base";
import { getPosStockSnapshot } from "@/lib/services/supabase/pos-stock";
import { findPosStockShortages } from "./lib/stock-freshness";
import { notifyPosStockChanged } from "./lib/stock-events";
import { useToast } from "@/lib/contexts";
import { formatCurrency, formatNumber, formatDecimal, parseNumberInput, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { printReceiptDirect, type ReceiptData } from "@/components/shared/print-receipt";
import { printShiftReport } from "@/lib/print-shift-report";
// CEO 03/07: POS in hóa đơn THEO MẪU chi nhánh (giống trang Hóa đơn admin).
import { resolvePrintTemplate } from "@/lib/services";
import { applyTemplateToDocData } from "@/lib/print-apply-template";
import { printDocument, type DocumentPrintData } from "@/lib/print-document";
// CEO 13/07: dựng khối khách trên phiếu POS qua CÙNG helper với trang Hóa đơn.
import {
  buildBuyerHeaderFields,
  buildInvoicePrintData,
  toPrintLines,
  type InvoiceFieldFlags,
} from "@/lib/print-templates";
import { PosBranchSelector } from "@/components/shared/pos-branch-selector";
import { useNetworkStatus, offlinePosCheckout } from "@/lib/offline";
import { useBarcodeScanner } from "@/lib/hooks/use-barcode-scanner";
import { useAuth } from "@/lib/contexts";
import { useSettings } from "@/lib/contexts/settings-context";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { getOpenShift, openShift, closeShift } from "@/lib/services/supabase/shifts";
import type { Shift } from "@/lib/types/shift";
import { OpenShiftDialog, CloseShiftDialog } from "./fnb/components/shift-dialog";
import { PendingShiftAlertSection } from "@/components/shared/shift/pending-shift-alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { usePosState, type OrderLine, type DiscountInput, type SellingMode, type DeliveryInfo, type PosSnapshot } from "./hooks/use-pos-state";
import { ProductGrid } from "./components/product-grid";
import { CustomerPicker } from "./components/customer-picker";
import { VariantPickerDialog } from "./components/variant-picker-dialog";
import { ConfirmDialog } from "@/components/shared/dialogs";
// PERF (CEO 23/05/2026): Lazy-load CreateCustomerDialog (534 dòng).
// POS load nhanh hơn ~80KB initial.
import dynamic from "next/dynamic";
const CreateCustomerDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/create-customer-dialog").then(
      (m) => m.CreateCustomerDialog,
    ),
  { ssr: false },
);
// Sprint B.6 (CEO 12/05): bỏ SupervisorPinDialog (1 PIN chung) →
// dùng OtpApprovalDialog (OTP per-user TTL 2 phút)
import { OtpApprovalDialog } from "@/components/shared/dialogs/otp-approval-dialog";
import { OTP_ACTION_CODES } from "@/lib/services/supabase/manager-otp";
import { getCustomers } from "@/lib/services/supabase/customers";
import { validateCoupon } from "@/lib/services/supabase/coupons";
import { Icon } from "@/components/ui/icon";
import { getVariantsByProduct } from "@/lib/services/supabase/variants";
import {
  resolveAppliedTier,
  resolveTierPrice,
  type TierPriceRule,
} from "@/lib/services/supabase/pricing";
import {
  resolveAppliedPromotion,
  type AppliedPromotion,
} from "@/lib/services/supabase/promotion-engine";
import {
  getLoyaltySettings,
  calculateRedeemDiscount,
} from "@/lib/services/supabase/loyalty";
import type { LoyaltySettings, Invoice, SalesOrder } from "@/lib/types";
import type { Product, ProductVariant } from "@/lib/types";

// Reuse FnB offline bar/drawer — both are generic over NetworkStatus.
import { ConnectionStatusBar } from "./fnb/components/connection-status-bar";
const ShiftInvoiceDrawer = lazy(() =>
  import("./components/shift-invoice-drawer").then((m) => ({ default: m.ShiftInvoiceDrawer }))
);
const SyncQueueDrawer = lazy(() =>
  import("./fnb/components/sync-queue-drawer").then((m) => ({ default: m.SyncQueueDrawer }))
);

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
function PosPageInner() {
  const router = useRouter();
  const { toast } = useToast();
  const state = usePosState();
  const {
    user,
    tenant,
    currentBranch,
    branches,
    switchBranch,
    logout,
  } = useAuth();

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
  // CEO 14/07: "Xử lý đặt hàng" — chọn đơn đặt hàng (DH) nạp vào POS.
  const [processOrderOpen, setProcessOrderOpen] = useState(false);
  // CEO 10/06/2026 — badge số nháp + trigger refresh sau save/delete
  const [draftCount, setDraftCount] = useState<number>(0);
  const [draftCountTrigger, setDraftCountTrigger] = useState(0);
  // Quick customer create — mở khi user click "+ Thêm KH mới" trong CustomerPicker
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createCustomerInitial, setCreateCustomerInitial] = useState<string>("");
  // CEO 05/06/2026: VAT đơn — dropdown 0/5/8/10%, mặc định 0% (KHÔNG tự áp).
  // Cashier chọn khi cần xuất hoá đơn VAT cho khách. Áp cấp đơn (trên total
  // sau discount + shipping) — khác taxAmount tính per-product.
  // P0-1 fix 12/06/2026: chuyển vào use-pos-state hook → state.orderVatRate
  // tự động fold vào state.total để checkout payload đúng số khách trả.
  // Coupon apply state
  const [couponCode, setCouponCode] = useState("");
  const [couponApplying, setCouponApplying] = useState(false);
  const [couponApplied, setCouponApplied] = useState<string | null>(null);
  // Supervisor PIN gate — mở khi giảm giá vượt ngưỡng + PIN đã cấu hình
  // Sprint B.6: thay supervisorPinOpen bằng discountOtpOpen (per-user OTP)
  const [discountOtpOpen, setDiscountOtpOpen] = useState(false);
  const pendingApprovalRef = useRef<(() => void) | null>(null);
  // Confirm dialog — dùng chung cho xóa giỏ hàng và huỷ sửa nháp.
  // Dạng "one-shot": mở dialog, lưu hành động vào pendingAction, user xác nhận → chạy.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    description: string;
    action: () => void;
  } | null>(null);
  const openConfirm = useCallback(
    (title: string, description: string, action: () => void) => {
      setConfirmConfig({ title, description, action });
      setConfirmOpen(true);
    },
    []
  );

  // Search + barcode
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cartScrollRef = useRef<HTMLDivElement>(null);

  // Barcode quick-add: lookup 1 sản phẩm theo tên/mã/barcode → add vào cart.
  // Shared giữa handleSearchEnter (search box Enter) + useBarcodeScanner
  // (USB scanner global). Nhận `query` trực tiếp để tránh race stale state.
  const lookupAndAdd = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q) return;
      if (!currentBranch?.id) {
        toast({
          title: "Chưa chọn chi nhánh",
          description: "Chọn một chi nhánh cụ thể trước khi thêm sản phẩm.",
          variant: "warning",
        });
        return;
      }
      try {
        const result = await getProducts({
          page: 0,
          pageSize: 1,
          search: q,
          sortBy: "code",
          sortOrder: "asc",
          filters: { status: "active", channel: "retail", productType: "sku" },
        });
        if (result.data.length > 0) {
          const product = result.data[0];
          const snapshot = await getPosStockSnapshot(
            [{ productId: product.id, hasBom: Boolean(product.hasBom) }],
            currentBranch.id,
          );
          const stockEntry = snapshot.get(product.id);
          const availableStock = stockEntry?.availableStock ?? Number(product.branchStock ?? 0);
          const effectiveProduct = { ...product, stock: availableStock };
          addLineWithTier(effectiveProduct, {
            availableStock,
            stockKnown: true,
          });
          setSearchQuery("");
          searchInputRef.current?.focus();
          setTimeout(() => {
            cartScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
          }, 50);
          if (availableStock <= 0) {
            toast({
              title: "Hết hàng",
              description: `"${product.name}" đã hết tại ${currentBranch.name}`,
              variant: "warning",
            });
          }
        } else {
          toast({
            title: "Không tìm thấy sản phẩm",
            description: `Mã/tên "${q}" không khớp SKU nào tại chi nhánh này.`,
            variant: "warning",
          });
        }
      } catch (err) {
        console.error("barcode quick-add error:", err);
        toast({
          title: "Lỗi khi tìm sản phẩm",
          description: (err as Error)?.message ?? "Vui lòng thử lại.",
          variant: "error",
        });
      }
    },
    [currentBranch?.id, currentBranch?.name, state, toast],
  );
  const handleSearchEnter = useCallback(
    () => lookupAndAdd(searchQuery),
    [searchQuery, lookupAndAdd],
  );

  // USB barcode scanner (keyboard-wedge) — listen global, kích hoạt ngay cả
  // khi focus KHÔNG ở search box. Dùng heuristic fast-typing để tránh
  // false-positive khi user gõ tay.
  useBarcodeScanner({
    onScan: (barcode) => lookupAndAdd(barcode),
  });

  // Note toggle
  const [noteOpen, setNoteOpen] = useState(false);

  // Keyboard shortcut helper
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Mobile/tablet: toggle cart panel visibility (slide-over)
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Variant picker state — opens when a product with multiple variants is clicked
  const [variantPickerProduct, setVariantPickerProduct] = useState<Product | null>(null);
  const [variantPickerList, setVariantPickerList] = useState<ProductVariant[]>([]);
  const [variantPickerLoading, setVariantPickerLoading] = useState(false);

  // Submit state — React state for UI + synchronous ref for double-call guard
  const [submitting, setSubmitting] = useState<"draft" | "complete" | null>(null);
  const submitLockRef = useRef(false);

  // ── Change dialog state (CEO 04/05/2026) ──
  // Khi cashier điền "Khách đưa" > tổng đơn → mở dialog hỏi cashier
  // chọn "Trả tiền thừa" hay "Ghi công nợ" (credit cho khách).
  // - "Ghi công nợ" chỉ enable khi có customer thật (không phải walk-in).
  const [changeDialog, setChangeDialog] = useState<{
    open: boolean;
    excess: number;
  }>({ open: false, excess: 0 });

  // CEO 29/05/2026: popup xác nhận khi bán đơn 0đ (miễn phí / hàng mẫu).
  const [zeroConfirmOpen, setZeroConfirmOpen] = useState(false);

  // ── Auto-save & recovery (Sprint POS-RECOVERY-1, CEO 04/05/2026) ──
  // clientSessionId: UUID idempotency key, regen mỗi khi clear cart.
  // - Auto-save background dùng key này để upsert draft trên server
  // - posCheckout dùng key này để chống duplicate khi cashier ấn 2 lần
  const [clientSessionId, setClientSessionId] = useState<string>(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  // Recovery dialog: list draft đang dở, hiện khi mount POS Retail.
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryDrafts, setRecoveryDrafts] = useState<DraftOrderSummary[]>([]);
  const recoveryShownRef = useRef(false);
  const [draftConflict, setDraftConflict] = useState<{ invoiceId: string | null } | null>(null);

  // Offline/online status — for opportunistic checkout while network is down
  const networkStatus = useNetworkStatus();
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);
  // R10: Drawer "Đơn ca này" — list 50 đơn gần nhất + reprint inline.
  const [shiftDrawerOpen, setShiftDrawerOpen] = useState(false);

  // Auto-print toggle
  const [autoPrint, setAutoPrint] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("pos.autoPrint");
    if (saved !== null) setAutoPrint(saved === "true");
  }, []);

  // ── Shift state ──
  // POS Retail cũng cần ca để báo cáo X/Z đúng. Logic giống FnB:
  // - Mount → check có ca đang mở của cashier này tại chi nhánh này không
  // - Không có → bắt mở ca trước khi cho thanh toán
  // - Có → cho phép bán, mọi invoice + cash_transaction gắn shift_id

  // CEO 13/05: POS Retail = bán sỉ qua Kho tổng. Nếu user đang ở Cửa hàng
  // FnB / Xưởng / Văn phòng → auto-switch sang kho tổng đầu tiên. Tránh
  // user bị stuck với checkout không trừ stock đúng nơi.
  useEffect(() => {
    // CEO 10/06/2026 — Nếu user vừa rời trang admin chọn "Tất cả chi nhánh"
    // (__all__) → currentBranch=null → POS không có chi nhánh, mọi SP báo
    // "Hết". Fallback: chi nhánh cụ thể gần nhất → profile.branch → Kho tổng
    // đầu tiên → branches[0]. Kế thừa logic anh muốn: "đang ở admin Kho Tổng
    // → POS phải hiện Kho Tổng".
    if (!currentBranch && branches.length > 0) {
      let fallbackId: string | null = null;
      try { fallbackId = localStorage.getItem("last_specific_branch_id"); } catch {}
      const fallback =
        (fallbackId && branches.find((b) => b.id === fallbackId)) ||
        (user?.branchId && branches.find((b) => b.id === user.branchId)) ||
        branches.find((b) => b.branchType === "warehouse") ||
        branches.find((b) => b.isDefault) ||
        branches[0];
      if (fallback) {
        void switchBranch(fallback.id);
        toast({
          title: `POS đã chọn: ${fallback.name}`,
          description: 'POS Retail cần 1 chi nhánh cụ thể. Đổi ở dropdown góc trên nếu muốn.',
          variant: "info",
          duration: 4000,
        });
      }
      return;
    }
    if (!currentBranch) return;
    if (currentBranch.branchType === "warehouse") return;
    const firstWarehouse = branches.find((b) => b.branchType === "warehouse");
    if (!firstWarehouse) return; // empty state handle ở dưới
    void switchBranch(firstWarehouse.id);
    toast({
      title: "Chuyển sang Kho tổng",
      description: `${currentBranch.name} là ${
        currentBranch.branchType === "store"
          ? "Cửa hàng FnB"
          : currentBranch.branchType === "factory"
            ? "Xưởng sản xuất"
            : "Văn phòng"
      } — POS Retail chỉ hoạt động ở Kho tổng. Đã chuyển sang "${firstWarehouse.name}".`,
      variant: "info",
      duration: 6000,
    });
  }, [currentBranch, branches, switchBranch, toast, user?.branchId]);
  const { settings,…46025 tokens truncated…t 440 = ~440 cart hiện
          chiều cao chia 4 buttons → mỗi button ~95px, đủ icon + label.
          Nhưng safe defensive: hide icon ở @sm queries không có nên dùng
          ml-0 + label always nowrap. */}
      <span className="shrink-0 hidden xl:inline-flex">{icon}</span>
      {label}
    </button>
  );
}

/** Selling mode tab — Stitch underline style, semibold MD3 */
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
        "relative inline-flex items-center gap-2 px-4 text-[11px] transition-colors",
        active
          ? "text-primary font-bold"
          : "text-on-surface-variant font-semibold hover:text-foreground"
      )}
    >
      {icon}
      {label}
      {/* Active underline indicator — Stitch 3px rounded */}
      {active && (
        <span className="absolute bottom-0 left-2 right-2 h-[3px] bg-primary rounded-full" />
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
    <div className="border-b border-border bg-status-warning/10 px-3 py-2 space-y-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-status-warning">
        <Icon name="local_shipping" size={14} />
        Thông tin giao hàng
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <input
            type="text"
            value={value.recipientName}
            onChange={(e) => update("recipientName", e.target.value)}
            placeholder="Tên người nhận"
            data-allow-hotkeys="true"
            className="w-full h-7 px-2 pl-7 rounded border border-border text-[11px] outline-none focus:border-primary bg-white"
          />
          <Icon name="person" size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>
        <div className="relative">
          <input
            type="tel"
            value={value.recipientPhone}
            onChange={(e) => update("recipientPhone", e.target.value)}
            placeholder="Số điện thoại"
            data-allow-hotkeys="true"
            className="w-full h-7 px-2 pl-7 rounded border border-border text-[11px] outline-none focus:border-primary bg-white"
          />
          <Icon name="call" size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>
      <div className="relative">
        <input
          type="text"
          value={value.address}
          onChange={(e) => update("address", e.target.value)}
          placeholder="Địa chỉ giao hàng (số nhà, đường, phường/xã)"
          data-allow-hotkeys="true"
          className="w-full h-7 px-2 pl-7 rounded border border-border text-[11px] outline-none focus:border-primary bg-white"
        />
        <Icon name="location_on" size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={value.district}
          onChange={(e) => update("district", e.target.value)}
          placeholder="Khu vực / Quận"
          data-allow-hotkeys="true"
          className="w-full h-7 px-2 rounded border border-border text-[11px] outline-none focus:border-primary bg-white"
        />
        <input
          type="text"
          value={value.ward}
          onChange={(e) => update("ward", e.target.value)}
          placeholder="Phường / Xã"
          data-allow-hotkeys="true"
          className="w-full h-7 px-2 rounded border border-border text-[11px] outline-none focus:border-primary bg-white"
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
            className="w-full h-7 px-2 rounded border border-border text-[11px] outline-none focus:border-primary bg-white tabular-nums"
          />
        </div>
        <label className="flex items-center gap-1 text-[10px] text-foreground whitespace-nowrap cursor-pointer select-none">
          <input
            type="checkbox"
            checked={value.codEnabled}
            onChange={(e) => update("codEnabled", e.target.checked)}
            className="h-3 w-3 rounded border-border text-primary"
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
        className="w-full h-7 px-2 rounded border border-border text-[11px] outline-none focus:border-primary bg-white"
      />
    </div>
  );
}

/**
 * Xử lý đặt hàng (CEO 14/07) — chọn ĐƠN ĐẶT HÀNG (DH, source='order') để nạp
 * vào POS xử lý/thanh toán, ngay trong màn bán (không phải qua trang Đơn đặt
 * hàng). Hơn KiotViet: mặc định chỉ "đơn chưa xử lý", hiện SĐT + tổng tiền,
 * bấm cả dòng để chọn. Tái dùng getOrders + state.loadDraft (đường đã kiểm).
 */
function ProcessOrderModal({
  open,
  onClose,
  branchId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string | null;
  onPick: (orderId: string) => void;
}) {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<"all" | "code" | "customer_name">(
    "all",
  );
  const [onlyPending, setOnlyPending] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    // Debounce search 250ms — tránh gọi server mỗi keystroke.
    const t = setTimeout(() => {
      getOrders({
        page: 0,
        pageSize: 50,
        search: search.trim() || undefined,
        searchField,
        branchId: branchId ?? undefined,
        filters: onlyPending
          ? { status: ["draft", "confirmed", "delivering"] }
          : undefined,
      })
        .then((r) => {
          // CEO 14/07: LUÔN loại đơn đã xuất hóa đơn (fulfilled) khỏi màn xử lý —
          // đã bán rồi thì không cho xử lý/thu tiền lần nữa. Lọc CLIENT-SIDE cho
          // an toàn cả khi cột fulfilled_by_id chưa có (pre-00188 → undefined →
          // không loại gì, đúng vì lúc đó chưa đơn nào fulfilled).
          if (!cancelled) setOrders(r.data.filter((o) => !o.fulfilledById));
        })
        .catch((e: unknown) => {
          if (!cancelled)
            toast({
              title: "Không tải được đơn đặt hàng",
              description: e instanceof Error ? e.message : "Lỗi",
              variant: "error",
            });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, search, searchField, onlyPending, branchId, toast]);

  if (!open) return null;

  const statusTone: Record<string, string> = {
    draft: "bg-status-warning/15 text-status-warning",
    confirmed: "bg-primary/15 text-primary",
    delivering: "bg-indigo-500/15 text-indigo-600",
    completed: "bg-status-success/15 text-status-success",
    cancelled: "bg-status-error/15 text-status-error",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="receipt_long" className="text-primary" />
            Xử lý đặt hàng
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Chọn đơn đặt hàng đã tạo để nạp vào màn bán và thanh toán.
          </p>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Icon
              name="search"
              size={16}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã đơn / khách hàng..."
              className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              autoFocus
            />
          </div>
          <select
            value={searchField}
            onChange={(e) =>
              setSearchField(e.target.value as typeof searchField)
            }
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="all">Tất cả</option>
            <option value="code">Mã đơn</option>
            <option value="customer_name">Khách hàng</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={onlyPending}
              onChange={(e) => setOnlyPending(e.target.checked)}
            />
            Chỉ đơn chưa xử lý
          </label>
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1.5 min-h-[220px]">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Icon name="progress_activity" className="animate-spin mr-2" />{" "}
              Đang tải...
            </div>
          ) : orders.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search
                ? "Không tìm thấy đơn phù hợp"
                : "Chưa có đơn đặt hàng nào"}
            </div>
          ) : (
            orders.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onPick(o.id)}
                className="w-full text-left rounded-lg border bg-card p-3 hover:border-primary hover:bg-primary/5 transition-colors flex items-center gap-3 press-scale-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary font-mono text-sm">
                      {o.code}
                    </span>
                    <span
                      className={cn(
                        "text-[11px] font-semibold px-1.5 py-0.5 rounded",
                        statusTone[o.status] ?? "bg-muted",
                      )}
                    >
                      {o.statusName}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {new Date(o.date).toLocaleString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "2-digit",
                    })}
                    {o.customerName ? <> · {o.customerName}</> : null}
                    {o.customerPhone ? <> · {o.customerPhone}</> : null}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold tabular-nums text-sm">
                    {formatCurrency(o.totalAmount)}đ
                  </div>
                  <div className="text-[11px] text-primary font-medium">
                    Chọn →
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
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
  // CEO 05/06/2026: bỏ silent catch — hiện lỗi rõ để debug khi DB có draft
  // nhưng UI báo "Chưa có". Trước đây nuốt mọi lỗi → giả thuyết "empty"
  // luôn thắng → CEO không biết lỗi RLS / query.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listDraftOrders()
      .then((rows) => {
        if (rows.length === 0) {
          console.warn("[DraftListModal] listDraftOrders trả về 0 rows");
        }
        setDrafts(rows);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Không tải được nháp";
        console.error("[DraftListModal] listDraftOrders lỗi:", err);
        toast({
          title: "Không tải được đơn nháp",
          description: msg,
          variant: "error",
        });
        setDrafts([]);
      })
      .finally(() => setLoading(false));
  }, [open, toast]);

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
            <Icon name="save" size={16} className="text-primary" />
            <h2 className="text-sm font-bold text-foreground">Đơn nháp đã lưu</h2>
            <kbd className="font-mono text-[9px] bg-muted border border-border rounded px-1 py-0.5 text-muted-foreground">
              F3
            </kbd>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Icon name="progress_activity" className="animate-spin text-primary" />
            </div>
          ) : drafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Icon name="save" size={32} className="mb-2 text-muted-foreground/35" />
              <p className="text-xs">Chưa có đơn nháp nào</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-primary-fixed/50 transition-colors group"
                >
                  {/* Draft info */}
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleLoad(draft.id)}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-primary">{draft.code}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(draft.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-foreground truncate">
                        {draft.customerName || "Khách lẻ"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">
                        {draft.itemCount} SP
                      </span>
                    </div>
                    {draft.note && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{draft.note}</p>
                    )}
                  </div>

                  {/* Total */}
                  <div className="text-right shrink-0">
                    <span className="text-xs font-bold text-foreground tabular-nums">
                      {formatCurrency(draft.total)}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleLoad(draft.id)}
                      className="px-2 py-1 rounded text-[10px] font-medium bg-primary-fixed text-primary hover:bg-primary-fixed transition-colors"
                    >
                      Tải
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(draft.id)}
                      disabled={deleting === draft.id}
                      className="p-1 rounded text-muted-foreground/60 hover:text-status-error hover:bg-status-error/10 transition-colors disabled:opacity-50"
                      title="Xóa nháp"
                    >
                      {deleting === draft.id ? (
                        <Icon name="progress_activity" size={14} className="animate-spin" />
                      ) : (
                        <Icon name="delete" size={14} />
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

export default function PosPage() {
  // POS Retail cần quyền checkout (pos_retail.checkout) — nhân viên bán lẻ,
  // ca trưởng, owner đều được cấp mặc định trong role template.
  return (
    <PermissionPage requires={PERMISSIONS.POS_RETAIL_CHECKOUT}>
      <PosPageInner />
    </PermissionPage>
  );
}

