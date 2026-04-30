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
import { printShiftReport } from "@/lib/print-shift-report";
import { PosBranchSelector } from "@/components/shared/pos-branch-selector";
import { useNetworkStatus, offlinePosCheckout } from "@/lib/offline";
import { useBarcodeScanner } from "@/lib/hooks/use-barcode-scanner";
import { useAuth } from "@/lib/contexts";
import { useSettings } from "@/lib/contexts/settings-context";
import { getOpenShift, openShift, closeShift } from "@/lib/services/supabase/shifts";
import type { Shift } from "@/lib/types/shift";
import { OpenShiftDialog, CloseShiftDialog } from "./fnb/components/shift-dialog";

import { usePosState, type OrderLine, type DiscountInput, type SellingMode, type DeliveryInfo, type PosSnapshot } from "./hooks/use-pos-state";
import { ProductGrid } from "./components/product-grid";
import { CustomerPicker } from "./components/customer-picker";
import { VariantPickerDialog } from "./components/variant-picker-dialog";
import { ConfirmDialog, CreateCustomerDialog, SupervisorPinDialog } from "@/components/shared/dialogs";
import { getCustomers } from "@/lib/services/supabase/customers";
import { validateCoupon } from "@/lib/services/supabase/coupons";
import { Icon } from "@/components/ui/icon";
import { getVariantsByProduct } from "@/lib/services/supabase/variants";
import { resolveAppliedTier } from "@/lib/services/supabase/pricing";
import {
  resolveAppliedPromotion,
  incrementPromotionUsage,
  type AppliedPromotion,
} from "@/lib/services/supabase/promotion-engine";
import type { Product, ProductVariant } from "@/lib/types";

// Reuse FnB offline bar/drawer — both are generic over NetworkStatus.
import { ConnectionStatusBar } from "./fnb/components/connection-status-bar";
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
  // Quick customer create — mở khi user click "+ Thêm KH mới" trong CustomerPicker
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createCustomerInitial, setCreateCustomerInitial] = useState<string>("");
  // Coupon apply state
  const [couponCode, setCouponCode] = useState("");
  const [couponApplying, setCouponApplying] = useState(false);
  const [couponApplied, setCouponApplied] = useState<string | null>(null);
  // Supervisor PIN gate — mở khi giảm giá vượt ngưỡng + PIN đã cấu hình
  const [supervisorPinOpen, setSupervisorPinOpen] = useState(false);
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
      try {
        const result = await getProducts({
          page: 0,
          pageSize: 1,
          search: q,
          sortBy: "code",
          sortOrder: "asc",
          // Barcode quick-add ở POS Retail chỉ quét SKU channel='retail'.
          filters: { status: "active", channel: "retail" },
        });
        if (result.data.length > 0) {
          const product = result.data[0];
          addLineWithTier(product);
          setSearchQuery("");
          searchInputRef.current?.focus();
          // Auto-scroll cart to bottom
          setTimeout(() => {
            cartScrollRef.current?.scrollTo({ top: cartScrollRef.current.scrollHeight, behavior: "smooth" });
          }, 50);
          if ((product.stock ?? 0) <= 0) {
            toast({ title: "Hết hàng", description: `"${product.name}" đã hết`, variant: "warning" });
          }
        } else {
          toast({
            title: "Không tìm thấy sản phẩm",
            description: `Mã/tên "${q}" không khớp SKU nào.`,
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
    [state, toast],
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

  // Offline/online status — for opportunistic checkout while network is down
  const networkStatus = useNetworkStatus();
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);

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
  const { user, tenant, currentBranch } = useAuth();
  const { settings } = useSettings();
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [openShiftDialogOpen, setOpenShiftDialogOpen] = useState(false);
  const [closeShiftDialogOpen, setCloseShiftDialogOpen] = useState(false);

  // Load ca đang mở khi branch/user sẵn sàng
  useEffect(() => {
    if (!currentBranch?.id || !user?.id) return;
    getOpenShift(currentBranch.id, user.id)
      .then((shift) => setCurrentShift(shift))
      .catch(() => {});
  }, [currentBranch?.id, user?.id]);

  const handleShiftClick = useCallback(() => {
    if (currentShift) setCloseShiftDialogOpen(true);
    else setOpenShiftDialogOpen(true);
  }, [currentShift]);

  // ── Guard giảm giá vượt ngưỡng bằng PIN quản lý ──
  // Nếu PIN chưa cấu hình (rỗng) → không chặn, cashier toàn quyền
  // Nếu vượt maxDiscount (%) HOẶC vượt threshold VND tuyệt đối → bật PIN dialog
  const handleOrderDiscountChange = useCallback(
    (d: import("./hooks/use-pos-state").DiscountInput) => {
      const pin = settings.sales.supervisorPin?.trim() ?? "";
      const maxPct = settings.sales.maxDiscount ?? 50;
      const maxAmt = settings.sales.supervisorDiscountAmountThreshold ?? 500_000;

      // Estimate final discount amount để so với threshold
      const est =
        d.mode === "percent"
          ? Math.round((state.subtotal * d.value) / 100)
          : d.value;
      const pctVsBase =
        state.subtotal > 0 ? (est * 100) / state.subtotal : 0;

      const overPct = d.mode === "percent" && d.value > maxPct;
      const overAmt = est > maxAmt || pctVsBase > maxPct;

      if (!pin) {
        // Không có PIN → hard cap: chặn vượt maxPct
        if (overPct) {
          toast({
            title: "Vượt mức giảm tối đa",
            description: `Mức giảm tối đa là ${maxPct}%. Đề nghị quản lý cấu hình PIN trong Cài đặt để cho phép duyệt vượt ngưỡng.`,
            variant: "warning",
          });
          return;
        }
        state.setOrderDiscount(d);
        return;
      }

      // PIN configured
      if (overPct || overAmt) {
        pendingApprovalRef.current = () => state.setOrderDiscount(d);
        setSupervisorPinOpen(true);
        return;
      }

      state.setOrderDiscount(d);
    },
    [settings.sales, state, toast]
  );

  // ── Áp mã giảm giá (coupon/voucher) ──
  const handleApplyCoupon = useCallback(async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) return;
    if (state.subtotal <= 0) {
      toast({ title: "Giỏ hàng trống", description: "Thêm sản phẩm trước khi áp mã.", variant: "warning" });
      return;
    }
    setCouponApplying(true);
    try {
      const result = await validateCoupon(code, state.subtotal, state.customer?.id);
      if (!result.valid) {
        toast({
          title: "Mã không hợp lệ",
          description: result.error ?? "Mã giảm giá không dùng được cho đơn này.",
          variant: "error",
        });
        return;
      }
      const amount = Number(result.discount_amount ?? 0);
      if (amount <= 0) {
        toast({ title: "Mã hợp lệ nhưng không giảm", description: "Kiểm tra điều kiện tối thiểu.", variant: "warning" });
        return;
      }
      state.setOrderDiscount({ mode: "amount", value: amount });
      setCouponApplied(code);
      toast({
        title: `Đã áp mã ${code}`,
        description: `Giảm ${amount.toLocaleString("vi-VN")}đ`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Không áp được mã",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    } finally {
      setCouponApplying(false);
    }
  }, [couponCode, state, toast]);

  const handleRemoveCoupon = useCallback(() => {
    setCouponApplied(null);
    setCouponCode("");
    state.setOrderDiscount({ mode: "amount", value: 0 });
  }, [state]);

  const handleOpenShift = useCallback(
    async (startingCash: number) => {
      if (!tenant?.id || !currentBranch?.id || !user?.id) return;
      try {
        const shift = await openShift({
          tenantId: tenant.id,
          branchId: currentBranch.id,
          cashierId: user.id,
          startingCash,
        });
        setCurrentShift(shift);
        setOpenShiftDialogOpen(false);
        toast({ title: "Đã mở ca", description: `Số dư đầu ca: ${startingCash.toLocaleString()} đ`, variant: "success" });
      } catch (err: any) {
        toast({ title: "Không mở được ca", description: err?.message ?? "Vui lòng thử lại.", variant: "error" });
      }
    },
    [tenant?.id, currentBranch?.id, user?.id, toast]
  );

  const handleCloseShift = useCallback(
    async (actualCash: number, note?: string) => {
      if (!currentShift) return;
      try {
        const report = await closeShift({ shiftId: currentShift.id, actualCash, note });

        // Auto-print Z report
        try {
          printShiftReport({
            type: "Z",
            storeName: settings.print.showStoreName ? settings.store.name : undefined,
            storeAddress: settings.print.showStoreAddress ? settings.store.address : undefined,
            storePhone: settings.print.showStorePhone ? settings.store.phone : undefined,
            branchName: currentBranch?.name,
            cashierName: report.cashierName ?? user?.fullName,
            openedAt: report.openedAt,
            closedAt: report.closedAt,
            startingCash: report.startingCash,
            cashIn: report.cashIn,
            cashOut: report.cashOut,
            expectedCash: report.expectedCash ?? 0,
            actualCash: report.actualCash ?? actualCash,
            cashDifference: report.cashDifference ?? 0,
            totalSales: report.totalSales,
            totalOrders: report.totalOrders,
            salesByMethod: report.salesByMethod,
            note: report.note,
            paperSize: settings.print.paperSize === "58mm" ? "58mm" : "80mm",
          });
        } catch (err) {
          console.error("printShiftReport(Z) error:", err);
        }

        setCurrentShift(null);
        setCloseShiftDialogOpen(false);

        const diff = report.cashDifference ?? 0;
        toast({
          title: "Đã đóng ca",
          description: `Chênh lệch: ${
            diff === 0 ? "KHỚP" : diff > 0 ? `THỪA ${diff.toLocaleString()}` : `THIẾU ${Math.abs(diff).toLocaleString()}`
          }`,
          variant: diff === 0 ? "success" : "warning",
        });
      } catch (err: any) {
        toast({ title: "Không đóng được ca", description: err?.message ?? "Vui lòng thử lại.", variant: "error" });
      }
    },
    [currentShift, settings, currentBranch, user, toast]
  );

  // Handle product click — if variants exist, open picker; else add directly
  const handleAddProduct = useCallback(
    async (product: Product) => {
      if (variantPickerLoading) return; // guard against double-tap

      setVariantPickerLoading(true);
      try {
        const variants = await getVariantsByProduct(product.id);
        if (variants.length === 0) {
          // No variants → add base product directly
          addLineWithTier(product);
          setTimeout(() => {
            cartScrollRef.current?.scrollTo({
              top: cartScrollRef.current.scrollHeight,
              behavior: "smooth",
            });
          }, 50);
          if ((product.stock ?? 0) <= 0) {
            toast({
              title: "Hết hàng",
              description: `"${product.name}" đã hết trong kho`,
              variant: "warning",
            });
          }
        } else {
          // Open variant picker dialog
          setVariantPickerProduct(product);
          setVariantPickerList(variants);
        }
      } catch (err) {
        // Fallback to base product on error (network issue etc.)
        addLineWithTier(product);
        toast({
          title: "Không tải được biến thể",
          description: err instanceof Error ? err.message : "Đã thêm sản phẩm gốc vào giỏ.",
          variant: "warning",
        });
      } finally {
        setVariantPickerLoading(false);
      }
    },
    [state, toast, variantPickerLoading]
  );

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

  // Auto-apply customer-group discount when customer is selected.
  // Safety: only overwrites orderDiscount if it's currently 0 (user hasn't set one).
  useEffect(() => {
    const pct = state.customer?.groupDiscountPercent ?? 0;
    if (pct <= 0) return;
    if (state.orderDiscount.value > 0) return; // respect manual override
    state.setOrderDiscount({ mode: "percent", value: pct });
    toast({
      title: `Khách ${state.customer?.groupName ?? "VIP"}`,
      description: `Áp dụng chiết khấu ${pct}% theo nhóm khách`,
      variant: "default",
    });
  }, [state.customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================
  // Sprint 2: Apply price tier theo KH đang chọn
  // ============================================================
  // Khi customer thay đổi → resolve tier (customer.priceTierId) → fetch
  // priceMap cho mọi SP đang trong cart → re-price.
  // appliedTier dùng để: (1) hiển thị badge "Áp: [tier]", (2) override
  // unitPrice khi addLine SP mới.
  const [appliedTier, setAppliedTier] = useState<{
    tierId: string;
    tierName: string;
    tierCode: string;
    priceMap: Map<string, number>;
  } | null>(null);

  // Wrapper addLine — inject tier price nếu có. Mọi nơi gọi state.addLine
  // trong page này phải qua addLineWithTier để giá tier được áp dụng cho
  // SP mới thêm vào cart.
  const addLineWithTier = useCallback(
    (
      product: Product,
      options?: { variantId?: string; variantLabel?: string; unitPrice?: number; quantity?: number },
    ) => {
      const tierPrice = appliedTier?.priceMap.get(product.id);
      // Nếu caller đã pass unitPrice (variant pricing) → giữ nguyên,
      // không override bởi tier vì variant có giá riêng.
      const effectiveOptions =
        options?.unitPrice !== undefined
          ? options
          : tierPrice !== undefined
            ? { ...options, unitPrice: tierPrice }
            : options;
      state.addLine(product, effectiveOptions);
    },
    [appliedTier, state],
  );

  useEffect(() => {
    const customerId = state.customer?.id;
    if (!customerId) {
      // Không có KH → clear tier (về giá niêm yết).
      if (appliedTier) {
        setAppliedTier(null);
        // Re-price cart về sellPrice gốc — em không có cache sellPrice.
        // Caller hiện chấp nhận: line đang hiện giá tier sẽ giữ giá đó cho
        // đến khi user xoá line, vì sellPrice gốc cần re-fetch product.
        // Acceptable cho V1 — V2 cache product trong line state.
      }
      return;
    }
    let cancelled = false;
    const productIds = state.lines.map((l) => l.productId);
    resolveAppliedTier({
      channel: "retail",
      customerId,
      productIds,
    })
      .then((tier) => {
        if (cancelled) return;
        if (!tier) {
          setAppliedTier(null);
          return;
        }
        setAppliedTier(tier);
        // Re-price các line khớp với tier
        let appliedCount = 0;
        for (const line of state.lines) {
          const tierPrice = tier.priceMap.get(line.productId);
          if (tierPrice !== undefined && tierPrice !== line.unitPrice) {
            state.updateLinePrice(line.lineId, tierPrice);
            appliedCount++;
          }
        }
        if (appliedCount > 0) {
          toast({
            title: `Áp dụng bảng giá: ${tier.tierName}`,
            description: `${appliedCount} sản phẩm trong giỏ đã re-price.`,
            variant: "default",
          });
        }
      })
      .catch(() => {
        // fail silent — fallback giá niêm yết
        setAppliedTier(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.customer?.id]);

  // ============================================================
  // Sprint KM-2: Apply promotion engine
  // ============================================================
  // Khi cart hoặc customer/branch đổi → resolve KM tốt nhất → set
  // orderDiscount theo discountAmount. User có thể click X trên banner
  // để clear thủ công (overrideClearedPromo = true → skip auto-resolve).
  const [appliedPromotion, setAppliedPromotion] = useState<AppliedPromotion | null>(null);
  const [promotionCleared, setPromotionCleared] = useState(false);

  // Check tenant-wide setting "Tự động áp dụng KM tốt nhất" → cache trong state.
  // Resolver tự đọc settings nên ở đây không cần lưu — engine respect setting.

  useEffect(() => {
    if (!currentBranch?.id) return;

    // User clicked X to clear → respect, don't auto re-apply until cart changes
    // significantly (a new "session"). Heuristic: clearCart resets promotionCleared.
    if (promotionCleared) return;

    // Cart rỗng → không apply KM
    if (state.lines.length === 0) {
      if (appliedPromotion) {
        setAppliedPromotion(null);
        // Clear orderDiscount nếu trước đó là do KM set
        state.setOrderDiscount({ mode: "amount", value: 0 });
      }
      return;
    }

    let cancelled = false;
    resolveAppliedPromotion({
      channel: "retail",
      branchId: currentBranch.id,
      customerId: state.customer?.id ?? null,
      items: state.lines.map((l) => ({
        productId: l.productId,
        // OrderLine không có categoryId hiện tại → null (KM theo category sẽ
        // không apply ở Retail V1; FnB có thể qua product.category_id nếu cần)
        categoryId: null,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    })
      .then(({ best }) => {
        if (cancelled) return;
        if (!best || best.discountAmount <= 0) {
          if (appliedPromotion) {
            setAppliedPromotion(null);
            state.setOrderDiscount({ mode: "amount", value: 0 });
          }
          return;
        }
        // Áp KM mới (hoặc đổi KM tốt hơn)
        if (appliedPromotion?.promotion.id !== best.promotion.id) {
          setAppliedPromotion(best);
          state.setOrderDiscount({ mode: "amount", value: best.discountAmount });
          toast({
            title: `Áp dụng khuyến mãi: ${best.promotion.name}`,
            description: `${best.reasonLabel} — Giảm ${best.discountAmount.toLocaleString("vi-VN")}đ`,
            variant: "success",
          });
        } else if (appliedPromotion.discountAmount !== best.discountAmount) {
          // Cùng promo, đổi discount (vd cart thay đổi qty)
          setAppliedPromotion(best);
          state.setOrderDiscount({ mode: "amount", value: best.discountAmount });
        }
      })
      .catch(() => {
        // fail silent — không block POS
        if (appliedPromotion) {
          setAppliedPromotion(null);
          state.setOrderDiscount({ mode: "amount", value: 0 });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lines.length, state.subtotal, state.customer?.id, currentBranch?.id, promotionCleared]);

  function clearAppliedPromotion() {
    setAppliedPromotion(null);
    setPromotionCleared(true);
    state.setOrderDiscount({ mode: "amount", value: 0 });
  }

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
    // Bắt mở ca trước khi thanh toán — không có ca = không biết ghi nhận vào đâu.
    if (!currentShift) {
      toast({
        title: "Chưa mở ca",
        description: "Anh/chị cần mở ca trước khi bán hàng để báo cáo X/Z đúng.",
        variant: "warning",
      });
      setOpenShiftDialogOpen(true);
      return;
    }
    submitLockRef.current = true;
    setSubmitting("complete");
    try {
      const ctx = await getCurrentContext();
      if (!ctx) throw new Error("Không xác định được chi nhánh");

      const paid = state.paid || state.total;
      let invoiceCode: string;
      let isOfflineCheckout = false;

      // Build breakdown for mixed payments
      const breakdown =
        state.paymentMethod === "mixed"
          ? state.paymentBreakdown.filter((b) => b.amount > 0)
          : undefined;

      if (state.loadedDraftId) {
        // Drafts live server-side already; block offline completion to avoid dupe.
        if (!networkStatus.isOnline) {
          throw new Error(
            "Đang offline: không thể hoàn tất phiếu nháp đã lưu. Vui lòng đợi mạng hoặc tạo hoá đơn mới."
          );
        }
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
            productName: l.variantLabel ? `${l.productName} · ${l.variantLabel}` : l.productName,
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
          shiftId: currentShift?.id ?? null,
        };
        const result = await offlinePosCheckout(input, networkStatus.isOnline);
        invoiceCode = result.invoiceCode;
        isOfflineCheckout = !!result.isOffline;
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
            isOffline: isOfflineCheckout,
          };
          printReceiptDirect(receipt);
        } catch {}
      }

      // KM-2: Tăng usage_count atomic — chỉ khi online (offline để sync sau)
      if (!isOfflineCheckout && appliedPromotion?.promotion.id) {
        try {
          await incrementPromotionUsage(appliedPromotion.promotion.id);
        } catch (err) {
          // Không block checkout — log warn để CEO biết
          console.warn("incrementPromotionUsage failed:", err);
        }
      }

      toast({
        title: isOfflineCheckout
          ? `Hoá đơn ${invoiceCode} — đã lưu offline`
          : `Hoá đơn ${invoiceCode} thành công!`,
        description: isOfflineCheckout
          ? "Đơn sẽ tự đồng bộ lên server khi có mạng"
          : undefined,
        variant: isOfflineCheckout ? "info" : "success",
      });
      state.clearCart();
      setAppliedPromotion(null);
      setPromotionCleared(false);
      setSearchQuery("");
      setMobileCartOpen(false);
    } catch (err: any) {
      toast({ title: "Thanh toán thất bại", description: err.message, variant: "error" });
    } finally {
      setSubmitting(null);
      submitLockRef.current = false;
    }
  }, [state, toast, autoPrint, networkStatus.isOnline, currentShift, appliedPromotion]);

  const handleDebtCheckout = useCallback(async () => {
    if (submitLockRef.current) return;
    if (!state.customer) {
      toast({ title: "Vui lòng chọn khách hàng để ghi nợ", variant: "error" });
      return;
    }
    if (!currentShift) {
      toast({
        title: "Chưa mở ca",
        description: "Anh/chị cần mở ca trước khi ghi nợ.",
        variant: "warning",
      });
      setOpenShiftDialogOpen(true);
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
        shiftId: currentShift?.id ?? null,
      };
      const result = await offlinePosCheckout(input, networkStatus.isOnline);

      toast({
        title: result.isOffline
          ? `Ghi nợ ${result.invoiceCode} — đã lưu offline`
          : `Ghi nợ ${result.invoiceCode} thành công!`,
        description: result.isOffline
          ? "Đơn sẽ tự đồng bộ lên server khi có mạng"
          : undefined,
        variant: result.isOffline ? "info" : "success",
      });
      state.clearCart();
      setSearchQuery("");
      setMobileCartOpen(false);
    } catch (err: any) {
      toast({ title: "Ghi nợ thất bại", description: err.message, variant: "error" });
    } finally {
      setSubmitting(null);
      submitLockRef.current = false;
    }
  }, [state, toast, networkStatus.isOnline, currentShift]);

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

      {/* ═══════════ OFFLINE STATUS BAR ═══════════ */}
      <ConnectionStatusBar
        status={networkStatus}
        onClick={() => setSyncDrawerOpen(true)}
      />

      {/* ═══════════ HEADER 40px ═══════════ */}
      <header className="h-10 bg-primary text-primary-foreground flex items-center px-3 shrink-0 gap-3">
        {/* Back */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-white/10 transition-colors shrink-0"
        >
          <Icon name="arrow_back" size={14} />
          <span className="hidden sm:inline">Quay lại</span>
        </Link>

        {/* Branch selector + Title — hiện rõ tên chi nhánh + code để user biết đang ghi nhận đơn ở đâu */}
        <PosBranchSelector variant="dark" filter={["warehouse", "store"]} showCode />
        <div className="h-4 w-px bg-white/20 shrink-0" />
        <div className="flex items-center gap-1.5 shrink-0">
          <Icon name="shopping_cart" size={14} />
          <span className="text-[13px] font-bold tracking-wide">POS Retail</span>
        </div>

        {/* Sprint 2: Badge tier đang áp dụng — chỉ hiện khi có KH với tier */}
        {appliedTier && (
          <div
            className="hidden md:flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-md bg-status-success/20 text-white text-[11px] font-medium border border-status-success/40"
            title={`Bảng giá ${appliedTier.tierCode} đang áp cho ${state.customer?.name ?? "KH này"}`}
          >
            <Icon name="sell" size={12} />
            <span>Áp: {appliedTier.tierName}</span>
          </div>
        )}

        {/* Sprint KM-2: Badge khuyến mãi đang áp dụng — click X để xóa */}
        {appliedPromotion && appliedPromotion.discountAmount > 0 && (
          <div
            className="hidden md:flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-md bg-status-warning/20 text-white text-[11px] font-medium border border-status-warning/40"
            title={`${appliedPromotion.promotion.name} — Giảm ${appliedPromotion.discountAmount.toLocaleString("vi-VN")}đ`}
          >
            <Icon name="percent" size={12} />
            <span>KM: {appliedPromotion.reasonLabel}</span>
            <button
              type="button"
              onClick={clearAppliedPromotion}
              className="ml-0.5 hover:bg-white/20 rounded-full p-0.5 transition-colors"
              title="Bỏ áp dụng khuyến mãi"
            >
              <Icon name="close" size={11} />
            </button>
          </div>
        )}

        {/* Search bar */}
        <div className="flex-1 max-w-lg mx-auto">
          <div className="relative">
            <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/50" />
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
                <Icon name="close" size={12} className="text-white/60" />
              </button>
            )}
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] bg-white/10 border border-white/20 rounded px-1 py-0.5 text-white/60">
              F2
            </kbd>
          </div>
        </div>

        {/* Shift button — status ca làm việc */}
        <button
          type="button"
          onClick={handleShiftClick}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded transition-colors shrink-0 text-[11px]",
            currentShift
              ? "bg-status-success/90 text-white hover:bg-status-success"
              : "bg-white/10 text-white/80 hover:bg-white/20"
          )}
          title={currentShift ? "Ca đang mở — click để đóng ca" : "Click để mở ca"}
        >
          <Icon name={currentShift ? "schedule" : "play_circle"} size={12} />
          <span className="hidden sm:inline">{currentShift ? "Đang mở ca" : "Mở ca"}</span>
        </button>

        {/* Draft button — always visible */}
        <button
          type="button"
          onClick={() => setDraftModalOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-white/70 hover:bg-white/10 hover:text-white transition-colors shrink-0 text-[11px]"
        >
          <Icon name="save" size={12} />
          <span className="hidden sm:inline">Nháp</span>
          <kbd className="hidden sm:inline font-mono text-[8px] bg-white/10 border border-white/20 rounded px-0.5 text-white/50">F3</kbd>
        </button>

        {/* Stats + Shortcuts — desktop only */}
        <div className="hidden md:flex items-center gap-2 shrink-0 text-[11px]">
          <div className="h-3 w-px bg-white/20" />
          <div className="flex items-center gap-1 text-white/70">
            <Icon name="shopping_cart" size={12} />
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
              <Icon name="keyboard" size={14} />
            </button>
            {showShortcuts && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowShortcuts(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-gray-900 text-white rounded-lg shadow-2xl p-3 w-56 text-[11px]">
                  <div className="font-bold text-xs mb-2 text-white/90 flex items-center gap-1.5">
                    <Icon name="keyboard" size={14} />
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
            onAddProduct={handleAddProduct}
          />
        </div>

        {/* ─── RIGHT: Cart + Payment Panel ─── */}
        <aside className={cn(
          "pos-panel bg-white flex flex-col",
          // Desktop: inline fixed-width panel. Trước đây 380px quá hẹp cho cart
          // (tên SP dài bị truncate, nút thanh toán đè nhau) — tăng dần theo
          // breakpoint để ở màn 2k/4k không bị "nép bên phải".
          "lg:w-[420px] xl:w-[460px] 2xl:w-[520px] lg:shrink-0 lg:border-l lg:border-border lg:static lg:translate-x-0 lg:z-auto lg:shadow-none",
          // Mobile/Tablet: slide-over from right
          "fixed inset-y-0 right-0 z-40 w-full sm:w-[420px] shadow-2xl",
          "transition-transform duration-300 ease-in-out",
          mobileCartOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        )}>
          {/* ── Invoice tabs bar — KiotViet multi-tab ── */}
          <div className="flex items-center bg-surface-container-low border-b border-border shrink-0 min-h-[32px]">
            {/* Mobile back button */}
            <button
              type="button"
              onClick={() => setMobileCartOpen(false)}
              className="lg:hidden shrink-0 h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary-fixed transition-colors border-r border-border"
              title="Quay lại sản phẩm"
            >
              <Icon name="arrow_back" size={16} />
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
                        ? "bg-white text-primary border-primary"
                        : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted"
                    )}
                  >
                    {tab.label}
                    {count > 0 && (
                      <span className={cn(
                        "inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full text-[9px] font-bold",
                        isActive ? "bg-primary-fixed text-primary" : "bg-muted text-muted-foreground"
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
                        className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-status-error/10 hover:text-status-error text-muted-foreground transition-all"
                      >
                        <Icon name="close" size={10} />
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
              className="shrink-0 h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary-fixed transition-colors border-l border-border"
              title="Tạo hoá đơn mới"
            >
              <Icon name="add" size={14} />
            </button>
          </div>

          {/* ── Draft indicator (when loaded from F3) ── */}
          {state.loadedDraftId && (
            <div className="flex items-center gap-2 px-3 py-1 bg-status-warning/10 border-b border-status-warning/25 text-[11px]">
              <Icon name="save" size={12} className="text-status-warning" />
              <span className="text-status-warning font-medium">Đang sửa nháp</span>
              <button
                type="button"
                onClick={() =>
                  openConfirm(
                    "Huỷ sửa nháp?",
                    "Các thay đổi chưa lưu sẽ bị mất. Giỏ hàng sẽ trở về trạng thái trống.",
                    () => {
                      state.clearCart();
                      toast({ title: "Đã huỷ sửa nháp", variant: "success" });
                    }
                  )
                }
                className="ml-auto text-status-warning hover:text-status-warning text-[10px] underline"
              >
                Huỷ
              </button>
            </div>
          )}

          {/* ── Customer picker row — Stitch pill ── */}
          <div className="px-3 py-2 border-b border-outline-variant/20">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCustomerModalOpen(true)}
                className={cn(
                  "flex-1 flex items-center gap-2 px-2.5 h-9 rounded-lg text-xs transition-colors press-scale-sm",
                  state.customer
                    ? "bg-primary-fixed text-primary font-semibold"
                    : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-foreground"
                )}
              >
                {state.customer ? (
                  <Icon name="person_check" size={14} className="text-primary shrink-0" />
                ) : (
                  <Icon name="person" size={14} className="shrink-0" />
                )}
                <span className="flex-1 text-left truncate font-medium">
                  {state.customer?.name ?? "Khách lẻ"}
                </span>
                <kbd className="font-mono text-[9px] bg-surface-container-lowest border border-outline-variant/30 rounded px-1 py-0.5 text-muted-foreground shrink-0">
                  F4
                </kbd>
              </button>
              {state.customer && (
                <button
                  type="button"
                  onClick={() => state.setCustomer(null)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-status-error hover:bg-status-error/10 transition-colors"
                  title="Gỡ khách"
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
            {/* Customer info strip — show phone + debt when selected */}
            {state.customer && (
              <div className="flex items-center gap-3 mt-1 px-1 text-[10px] text-muted-foreground">
                {state.customer.phone && (
                  <span className="flex items-center gap-0.5">
                    <Icon name="call" size={10} />
                    {state.customer.phone}
                  </span>
                )}
                {(state.customer.currentDebt ?? 0) > 0 && (
                  <span className="flex items-center gap-0.5 text-status-error font-semibold">
                    Nợ cũ: {formatCurrency(state.customer.currentDebt ?? 0)}
                  </span>
                )}
                {state.customer.code && (
                  <span className="text-muted-foreground font-mono">{state.customer.code}</span>
                )}
                {(state.customer.groupDiscountPercent ?? 0) > 0 && (
                  <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-status-success/10 text-status-success font-semibold">
                    <Icon name="loyalty" size={10} />
                    {state.customer.groupName ?? "Nhóm"} −{state.customer.groupDiscountPercent}%
                  </span>
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
            <div className="flex items-center border-b border-border bg-surface-container-low shrink-0">
              <div className="flex-1 grid grid-cols-[20px_1fr_66px_44px_60px_66px_18px] gap-0 px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider items-center">
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
                onClick={() =>
                  openConfirm(
                    `Xoá toàn bộ ${state.lines.length} dòng khỏi giỏ hàng?`,
                    "Các sản phẩm đang chọn sẽ bị xoá. Không thể hoàn tác.",
                    () => {
                      state.clearCart();
                      toast({ title: "Đã xoá giỏ hàng", variant: "success" });
                    }
                  )
                }
                className="shrink-0 px-1.5 py-0.5 mr-1 rounded text-[9px] text-muted-foreground hover:text-status-error hover:bg-status-error/10 transition-colors"
                title="Xoá tất cả (cần xác nhận)"
              >
                <Icon name="delete" size={12} />
              </button>
            </div>
          )}

          {/* ── Cart items list ── */}
          <div ref={cartScrollRef} className="flex-1 overflow-y-auto min-h-0">
            {state.lines.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6">
                <Icon name="shopping_cart" size={32} className="mb-2 text-gray-200" />
                <p className="text-xs font-medium text-muted-foreground">Giỏ hàng trống</p>
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

          {/* KM-3: Free items section — hiển thị quà tặng kèm (BOGO + gift) */}
          {appliedPromotion?.freeItems && appliedPromotion.freeItems.length > 0 && (
            <div className="border-t border-status-warning/30 px-3 py-2 bg-status-warning/5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon name="redeem" size={14} className="text-status-warning" />
                <span className="text-xs font-semibold text-status-warning">
                  Tặng kèm ({appliedPromotion.freeItems.length} món)
                </span>
              </div>
              <div className="space-y-0.5 pl-5">
                {appliedPromotion.freeItems.map((free) => {
                  // Lookup product name từ cart line trước; nếu không có
                  // (gift product không có trong cart) → fallback empty.
                  const lineMatch = state.lines.find((l) => l.productId === free.productId);
                  const name = lineMatch?.productName ?? free.productName ?? "Sản phẩm";
                  return (
                    <div
                      key={free.productId}
                      className="flex items-center justify-between text-[11px]"
                    >
                      <span className="truncate text-foreground">
                        {name} <span className="text-muted-foreground">× {free.quantity}</span>
                      </span>
                      {free.unitPrice > 0 && (
                        <span className="text-muted-foreground tabular-nums shrink-0 ml-2">
                          {formatCurrency(free.quantity * free.unitPrice)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Totals section ── */}
          <div className="border-t border-border px-3 py-2 space-y-1 bg-surface-container-low/50">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Tổng tiền hàng ({state.itemCount} SP)</span>
              <span className="font-medium text-foreground tabular-nums">
                {formatCurrency(state.subtotal)}
              </span>
            </div>

            {/* Giảm giá — always visible like KiotViet */}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Giảm giá</span>
              <span className={cn("tabular-nums", (state.lineDiscountTotal + state.orderDiscountAmount) > 0 && "text-status-warning")}>
                {(state.lineDiscountTotal + state.orderDiscountAmount) > 0
                  ? `−${formatCurrency(state.lineDiscountTotal + state.orderDiscountAmount)}`
                  : "0"
                }
              </span>
            </div>

            {/* Order discount — hidden in fast mode */}
            {state.sellingMode !== "fast" && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Chiết khấu đơn
                  {settings.sales.supervisorPin && (
                    <Icon
                      name="lock"
                      size={10}
                      className="inline ml-1 text-status-warning align-text-top"
                      title="Giảm giá vượt ngưỡng cần PIN quản lý"
                    />
                  )}
                </span>
                <OrderDiscountInput
                  value={state.orderDiscount}
                  onChange={handleOrderDiscountChange}
                />
              </div>
            )}

            {/* Coupon / voucher — hidden in fast mode */}
            {state.sellingMode !== "fast" && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground shrink-0">Mã KM</span>
                {couponApplied ? (
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-status-success/10 text-status-success text-[11px] font-bold">
                    <Icon name="check_circle" size={12} />
                    {couponApplied}
                    <button
                      type="button"
                      onClick={handleRemoveCoupon}
                      className="ml-1 hover:text-status-error"
                      title="Huỷ mã"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="inline-flex items-stretch h-6 rounded border border-border overflow-hidden bg-white">
                    <input
                      type="text"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleApplyCoupon();
                        }
                      }}
                      data-allow-hotkeys="true"
                      placeholder="Nhập mã"
                      className="w-20 px-1.5 text-[10px] outline-none uppercase"
                      maxLength={20}
                    />
                    <button
                      type="button"
                      onClick={handleApplyCoupon}
                      disabled={couponApplying || !couponCode.trim()}
                      className="px-2 text-[10px] font-bold border-l border-border bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {couponApplying ? "..." : "Áp"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Shipping fee */}
            {state.sellingMode === "delivery" && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Phí giao hàng</span>
                <span className="tabular-nums">
                  {state.shippingFee > 0 ? `+${formatCurrency(state.shippingFee)}` : "0"}
                </span>
              </div>
            )}

            {/* VAT */}
            {state.taxAmount > 0 && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Thuế GTGT</span>
                <span className="tabular-nums">
                  +{formatCurrency(state.taxAmount)}
                </span>
              </div>
            )}

            {/* Total — Stitch font-heading extrabold primary */}
            <div className="flex justify-between items-baseline pt-1.5 border-t border-outline-variant/20">
              <span className="text-sm font-semibold text-foreground">Khách cần trả</span>
              <span className="font-heading text-lg font-extrabold text-primary tabular-nums tracking-tight">
                {formatCurrency(state.total)} ₫
              </span>
            </div>
          </div>

          {/* ── Payment section (hidden in fast mode) ── */}
          {state.sellingMode !== "fast" && (
            <div className="border-t border-border px-3 py-2 space-y-2">
              {/* Payment method */}
              <div className="grid grid-cols-4 gap-1.5">
                <PaymentBtn
                  icon={<Icon name="payments" size={14} />}
                  label="Tiền mặt"
                  active={state.paymentMethod === "cash"}
                  onClick={() => state.setPaymentMethod("cash")}
                />
                <PaymentBtn
                  icon={<Icon name="apartment" size={14} />}
                  label="CK"
                  active={state.paymentMethod === "transfer"}
                  onClick={() => state.setPaymentMethod("transfer")}
                />
                <PaymentBtn
                  icon={<Icon name="credit_card" size={14} />}
                  label="Thẻ"
                  active={state.paymentMethod === "card"}
                  onClick={() => state.setPaymentMethod("card")}
                />
                <PaymentBtn
                  icon={<Icon name="layers" size={14} />}
                  label="Hỗn hợp"
                  active={state.paymentMethod === "mixed"}
                  onClick={() => state.setPaymentMethod("mixed")}
                />
              </div>

              {/* Mixed payment breakdown */}
              {state.paymentMethod === "mixed" ? (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Chi tiết thanh toán
                  </label>
                  {([
                    { method: "cash" as const, label: "Tiền mặt", icon: <Icon name="payments" size={12} className="text-status-success" /> },
                    { method: "transfer" as const, label: "Chuyển khoản", icon: <Icon name="apartment" size={12} className="text-primary" /> },
                    { method: "card" as const, label: "Thẻ", icon: <Icon name="credit_card" size={12} className="text-status-info" /> },
                  ]).map((pm) => {
                    const item = state.paymentBreakdown.find((b) => b.method === pm.method);
                    return (
                      <div key={pm.method} className="flex items-center gap-2">
                        <div className="flex items-center gap-1 w-20 shrink-0">
                          {pm.icon}
                          <span className="text-[10px] text-foreground">{pm.label}</span>
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
                          className="flex-1 h-7 px-2 rounded border border-border text-right text-xs font-bold outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary tabular-nums"
                        />
                      </div>
                    );
                  })}
                  {/* Breakdown summary */}
                  <div className="flex items-center justify-between pt-1 border-t border-dashed border-border">
                    <span className="text-[10px] text-muted-foreground">Tổng đã nhập</span>
                    <span
                      className={cn(
                        "text-xs font-bold tabular-nums",
                        state.breakdownTotal >= state.total
                          ? "text-status-success"
                          : "text-status-warning"
                      )}
                    >
                      {formatCurrency(state.breakdownTotal)} / {formatCurrency(state.total)} ₫
                    </span>
                  </div>
                  {state.breakdownTotal > 0 && state.breakdownTotal < state.total && (
                    <p className="text-[10px] text-status-warning">
                      Còn thiếu {formatCurrency(state.total - state.breakdownTotal)} ₫
                    </p>
                  )}
                  {state.breakdownTotal > state.total && (
                    <p className="text-[10px] text-status-success">
                      Thừa {formatCurrency(state.breakdownTotal - state.total)} ₫
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {/* Single-method: Paid amount */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Khách đưa
                      </label>
                      {state.paid > 0 && state.change > 0 && (
                        <span className="text-[11px] font-bold text-status-success bg-status-success/10 px-1.5 py-0.5 rounded">
                          Thừa: {formatCurrency(state.change)} ₫
                        </span>
                      )}
                      {state.paid > 0 && state.debt > 0 && (
                        <span className="text-[11px] font-bold text-status-warning bg-status-warning/10 px-1.5 py-0.5 rounded">
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
                        "w-full h-9 px-3 rounded border text-right text-sm font-bold outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary tabular-nums transition-colors",
                        state.paid > 0 && state.paid >= state.total
                          ? "border-status-success/25 bg-status-success/10"
                          : state.paid > 0 && state.paid < state.total
                          ? "border-status-warning/25 bg-status-warning/10"
                          : "border-border"
                      )}
                    />
                  </div>

                  {/* Denomination buttons — Stitch pill group */}
                  <div className="flex gap-1">
                    {DENOMINATIONS.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => state.setPaid(d.value)}
                        className="flex-1 h-8 rounded-lg bg-surface-container-low text-[10px] font-semibold text-on-surface-variant hover:bg-primary-fixed hover:text-primary transition-colors press-scale-sm"
                      >
                        {d.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => state.setPaid(state.total)}
                      className="flex-1 h-8 rounded-lg bg-primary-fixed text-[10px] font-bold text-primary hover:bg-primary-fixed/70 transition-colors press-scale-sm"
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
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Icon name="expand_more"
                    className={cn(
                                                                                              "h-2.5 w-2.5 transition-transform",
                                                                                              noteOpen && "rotate-180"
                                                                                            )}
                  />
                  Ghi chú
                </button>
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoPrint}
                    onChange={() => {
                      const next = !autoPrint;
                      setAutoPrint(next);
                      localStorage.setItem("pos.autoPrint", String(next));
                    }}
                    className="h-3 w-3 rounded border-border text-primary focus:ring-primary"
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
                  className="w-full px-2.5 py-1.5 rounded border border-border text-xs resize-none outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  placeholder="Ghi chú cho đơn hàng..."
                />
              )}
            </div>
          )}

          {/* ── Action buttons — Stitch primary style ── */}
          <div className={cn(
            "px-3 py-2.5 border-t border-outline-variant/20 shrink-0 bg-surface-container-lowest",
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
                "rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1 transition-all press-scale-sm",
                state.sellingMode === "fast" ? "h-9" : "h-11"
              )}
            >
              {submitting === "draft" ? (
                <Icon name="progress_activity" size={14} className="animate-spin" />
              ) : (
                <Icon name="save" size={14} />
              )}
              Nháp
              <kbd className="font-mono text-[8px] bg-surface-container-lowest border border-outline-variant/30 rounded px-0.5 text-muted-foreground">
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
                "rounded-lg bg-status-warning/10 text-xs font-semibold text-status-warning hover:bg-status-warning/15 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1 transition-all press-scale-sm",
                state.sellingMode === "fast" ? "h-9" : "h-11"
              )}
            >
              <Icon name="credit_card" size={14} />
              Ghi nợ
            </button>
            {/* Checkout button — primary Stitch */}
            <button
              type="button"
              onClick={handleComplete}
              disabled={state.lines.length === 0 || submitting !== null}
              className={cn(
                "rounded-xl bg-primary text-on-primary font-bold hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 transition-all ambient-shadow press-scale-sm",
                state.sellingMode === "fast"
                  ? "h-12 text-base"
                  : "h-11 text-[13px]"
              )}
            >
              {submitting === "complete" ? (
                <Icon name="progress_activity" size={16} className="animate-spin" />
              ) : (
                <Icon name="check_circle" size={16} />
              )}
              Thanh toán
              <kbd className={cn(
                "font-mono bg-on-primary/15 border border-on-primary/25 rounded px-1 py-0.5 text-on-primary/90",
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
              ? "bottom-12 h-12 bg-primary text-primary-foreground"
              : "bottom-12 h-10 bg-white/95 backdrop-blur border border-border text-foreground"
          )}
        >
          <div className="flex items-center gap-2">
            <div className="relative">
              <Icon name="shopping_cart" />
              {state.itemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] rounded-full bg-status-error text-white text-[9px] font-bold flex items-center justify-center px-0.5">
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
      <div className="h-8 bg-white border-t border-border flex items-stretch px-3 gap-0 shrink-0">
        <SellingModeTab
          icon={<Icon name="bolt" size={12} />}
          label="Bán nhanh"
          active={state.sellingMode === "fast"}
          onClick={() => state.setSellingMode("fast")}
        />
        <SellingModeTab
          icon={<Icon name="schedule" size={12} />}
          label="Bán thường"
          active={state.sellingMode === "normal"}
          onClick={() => state.setSellingMode("normal")}
        />
        <SellingModeTab
          icon={<Icon name="local_shipping" size={12} />}
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
        onRequestCreate={(initialName) => {
          setCreateCustomerInitial(initialName);
          setCreateCustomerOpen(true);
        }}
      />
      {/* Quick-create customer — khi user click "+ Thêm KH mới" trong CustomerPicker.
          Sau khi tạo xong, tự động tìm lại khách vừa tạo rồi gán vào hoá đơn. */}
      <CreateCustomerDialog
        open={createCustomerOpen}
        onOpenChange={setCreateCustomerOpen}
        onSuccess={() => {
          // Refetch customer vừa tạo bằng search theo tên để auto-select
          // (createCustomer không return customer object, nên phải query lại).
          if (!createCustomerInitial) return;
          getCustomers({
            page: 0,
            pageSize: 1,
            search: createCustomerInitial,
            filters: {},
            sortBy: "name",
            sortOrder: "asc",
          })
            .then((res) => {
              if (res.data.length > 0) {
                state.setCustomer(res.data[0]);
                toast({
                  title: "Đã chọn khách hàng",
                  description: res.data[0].name,
                  variant: "success",
                });
              }
            })
            .catch(() => {});
        }}
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

      {/* Xác nhận hành động huỷ (xoá giỏ / huỷ nháp) — dùng chung */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={confirmConfig?.title ?? ""}
        description={confirmConfig?.description ?? ""}
        variant="destructive"
        confirmLabel="Xác nhận"
        cancelLabel="Giữ lại"
        onConfirm={() => {
          confirmConfig?.action();
          setConfirmOpen(false);
        }}
      />

      {/* Variant picker — opens when clicking a product that has packaging variants */}
      <VariantPickerDialog
        open={!!variantPickerProduct}
        onOpenChange={(open) => {
          if (!open) {
            setVariantPickerProduct(null);
            setVariantPickerList([]);
          }
        }}
        product={variantPickerProduct}
        variants={variantPickerList}
        onConfirm={(payload) => {
          if (!variantPickerProduct) return;
          // Variant đã có giá riêng → addLineWithTier không override
          // (chỉ inject tier price khi options.unitPrice undefined).
          addLineWithTier(variantPickerProduct, {
            variantId: payload.variantId,
            variantLabel: payload.variantLabel,
            unitPrice: payload.unitPrice,
            quantity: payload.quantity,
          });
          setTimeout(() => {
            cartScrollRef.current?.scrollTo({
              top: cartScrollRef.current.scrollHeight,
              behavior: "smooth",
            });
          }, 50);
          toast({
            title: `Đã thêm ${variantPickerProduct.name}`,
            description: `${payload.variantLabel} × ${payload.quantity}`,
            variant: "success",
          });
        }}
      />

      {/* Sync queue drawer — opens when ConnectionStatusBar is clicked */}
      {syncDrawerOpen && (
        <Suspense fallback={null}>
          <SyncQueueDrawer
            open={syncDrawerOpen}
            onOpenChange={setSyncDrawerOpen}
            status={networkStatus}
          />
        </Suspense>
      )}

      {/* Supervisor PIN — gate giảm giá vượt ngưỡng */}
      <SupervisorPinDialog
        open={supervisorPinOpen}
        onOpenChange={setSupervisorPinOpen}
        correctPin={settings.sales.supervisorPin ?? ""}
        title="Duyệt giảm giá vượt ngưỡng"
        description={`Mức giảm vượt ${settings.sales.maxDiscount ?? 50}% hoặc ${(settings.sales.supervisorDiscountAmountThreshold ?? 500_000).toLocaleString("vi-VN")}đ — cần quản lý duyệt.`}
        onApproved={() => {
          pendingApprovalRef.current?.();
          pendingApprovalRef.current = null;
          toast({
            title: "Đã duyệt",
            description: "Giảm giá đã được áp dụng.",
            variant: "success",
          });
        }}
      />

      {/* Shift dialogs — mở/đóng ca */}
      {openShiftDialogOpen && (
        <OpenShiftDialog
          open={openShiftDialogOpen}
          onOpenChange={setOpenShiftDialogOpen}
          onConfirm={handleOpenShift}
        />
      )}
      {closeShiftDialogOpen && (
        <CloseShiftDialog
          open={closeShiftDialogOpen}
          onOpenChange={setCloseShiftDialogOpen}
          currentShift={currentShift}
          onConfirm={handleCloseShift}
        />
      )}
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
        "grid grid-cols-[20px_1fr_66px_44px_60px_66px_18px] gap-0 px-2 py-1.5 hover:bg-primary-fixed/30 transition-colors group items-center",
        oversold && "bg-status-warning/10"
      )}
    >
      {/* Line number */}
      <span className="text-[10px] text-muted-foreground text-center tabular-nums">{index}</span>

      {/* Name + code + unit */}
      <div className="min-w-0 pr-1">
        <p className="text-[11px] font-medium text-foreground truncate leading-tight">
          {line.productName}
          {line.variantLabel && (
            <span className="ml-1 px-1 py-0.5 rounded bg-primary-fixed/50 text-primary text-[9px] font-semibold">
              {line.variantLabel}
            </span>
          )}
        </p>
        <p className="text-[9px] text-muted-foreground font-mono truncate leading-tight">
          {line.productCode && <span>{line.productCode}</span>}
          {line.unit && (
            <span className="text-muted-foreground ml-1">({line.unit})</span>
          )}
          {oversold && (
            <span className="text-status-warning ml-1">Tồn: {line.availableStock}</span>
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
        className="h-6 w-full px-1 text-right text-[10px] font-medium tabular-nums outline-none bg-transparent border border-transparent hover:border-border focus:border-primary focus:bg-white rounded transition-colors"
      />

      {/* Qty */}
      <div className="flex items-center justify-center">
        <input
          type="number"
          min={1}
          value={line.quantity}
          onChange={(e) => onQtyChange(parseInt(e.target.value) || 1)}
          data-allow-hotkeys="true"
          className="h-6 w-10 text-center text-[11px] font-semibold tabular-nums outline-none bg-transparent border border-transparent hover:border-border focus:border-primary focus:bg-white rounded transition-colors"
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
          className="h-6 w-10 px-0.5 text-right text-[10px] tabular-nums outline-none bg-transparent border border-transparent hover:border-border focus:border-primary focus:bg-white rounded-l transition-colors"
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
              ? "bg-primary-fixed text-primary border-primary-fixed"
              : "bg-surface-container-low text-muted-foreground border-border hover:bg-muted"
          )}
        >
          {line.discount.mode === "percent" ? "%" : "₫"}
        </button>
      </div>

      {/* Line total */}
      <div className="text-right">
        <span className="text-[11px] font-bold text-foreground tabular-nums">
          {formatCurrency(lineTotal)}
        </span>
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={onRemove}
        className="p-0.5 rounded text-gray-300 hover:text-status-error hover:bg-status-error/10 opacity-0 group-hover:opacity-100 transition-all justify-self-center"
        title="Xóa"
      >
        <Icon name="close" size={12} />
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
    <div className="inline-flex items-stretch h-6 rounded border border-border overflow-hidden bg-white">
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
          "w-6 flex items-center justify-center text-[10px] border-l border-border font-bold transition-colors",
          value.mode === "percent"
            ? "bg-primary-fixed text-primary"
            : "bg-surface-container-low text-muted-foreground hover:bg-muted"
        )}
      >
        {value.mode === "percent" ? "%" : "₫"}
      </button>
    </div>
  );
}

/** Payment method button — Stitch pill with primary-fixed inactive */
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
        "h-8 rounded-lg text-[10px] font-semibold transition-all press-scale-sm inline-flex items-center justify-center gap-1",
        active
          ? "bg-primary text-on-primary ambient-shadow"
          : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-foreground"
      )}
    >
      {icon}
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
        "relative inline-flex items-center gap-1.5 px-4 text-[11px] transition-colors",
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
    <div className="border-b border-border bg-status-warning/10 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-status-warning">
        <Icon name="local_shipping" size={12} />
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
            className="w-full h-7 px-2 pl-7 rounded border border-border text-[11px] outline-none focus:border-primary bg-white"
          />
          <Icon name="person" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
          <Icon name="call" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
        <Icon name="location_on" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
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
              <Icon name="save" size={32} className="mb-2 text-gray-200" />
              <p className="text-xs">Chưa có đơn nháp nào</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-primary-fixed/50 transition-colors group"
                >
                  {/* Draft info */}
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleLoad(draft.id)}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-primary">{draft.code}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(draft.createdAt).toLocaleString("vi-VN", {
                          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                        })}
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
                      className="p-1 rounded text-gray-300 hover:text-status-error hover:bg-status-error/10 transition-colors disabled:opacity-50"
                      title="Xóa nháp"
                    >
                      {deleting === draft.id ? (
                        <Icon name="progress_activity" size={12} className="animate-spin" />
                      ) : (
                        <Icon name="delete" size={12} />
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
