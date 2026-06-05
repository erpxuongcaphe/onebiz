"use client";

import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { useAuth, useToast } from "@/lib/contexts";
import { PermissionPage } from "@/components/shared/permission-page";
import { PERMISSIONS } from "@/lib/permissions";
import { useSettings } from "@/lib/contexts/settings-context";
import { getProductCategoriesAsync } from "@/lib/services/supabase/products";
import { getVariantsByProduct, getVariantsByProductIds } from "@/lib/services/supabase/variants";
import { resolveAppliedTier } from "@/lib/services/supabase/pricing";
import {
  resolveAppliedPromotion,
  incrementPromotionUsage,
  type AppliedPromotion,
} from "@/lib/services/supabase/promotion-engine";
import { tagInvoicePromotion } from "@/lib/services/supabase/promotions";
import {
  earnLoyaltyPoints,
  getLoyaltySettings,
  redeemLoyaltyPoints,
  calculateRedeemDiscount,
} from "@/lib/services/supabase/loyalty";
import { fnbPayment } from "@/lib/services/supabase/fnb-checkout";
import { recordDiscountAudit } from "@/lib/services/supabase/pos-checkout";
import { getTablesByBranch, markTableAvailable } from "@/lib/services/supabase/fnb-tables";
import {
  useNetworkStatus,
  offlineSendToKitchen,
  offlineFnbPayment,
  offlineAddItemsToExistingOrder,
  prefetchMenuData,
  prefetchTableData,
  getMenuFromCache,
  getTablesFromCache,
  shouldRefreshMenu,
  saveVariantsToCache,
  getVariantsFromCache,
  shouldRefreshVariants,
  hapticTap,
  hapticSuccess,
  hapticError,
} from "@/lib/offline";
import { splitByItems, splitEqually } from "@/lib/services/supabase/split-bill";
import { validateCoupon } from "@/lib/services/supabase/coupons";
import { getKitchenOrderById, getKitchenOrders, cancelUnpaidKitchenOrder, transferTable as transferTableService, setDeliveryPlatform as setDeliveryPlatformService } from "@/lib/services/supabase/kitchen-orders";
import { OtpApprovalDialog } from "@/components/shared/dialogs/otp-approval-dialog";
import { OTP_ACTION_CODES } from "@/lib/services/supabase/manager-otp";
import { getOpenShift, openShift, closeShift } from "@/lib/services/supabase/shifts";
import {
  getDeliveryPlatformSettings,
  getDiscountPresets,
  type DeliveryPlatformSettings,
  type DiscountPreset,
} from "@/lib/services/supabase/fnb-platform-settings";
import { getClient } from "@/lib/services/supabase/base";
// CEO 01/06/2026 — Sprint 2.2e: dynamic modifier groups cho POS FnB
import {
  getEffectiveModifierGroupsForProduct,
  listModifierOptions,
  type ModifierGroup,
  type ModifierOption,
} from "@/lib/services/supabase/modifier-groups";
import type { DynamicModifierData } from "./components/fnb-item-dialog";
import { printKitchenTicketV2, printPreBill, printFnbReceipt } from "@/lib/print-fnb";
import { printKitchenTicketsByStation } from "./print-stations";
import { printShiftReport } from "@/lib/print-shift-report";
import type { RestaurantTable, FnbOrderLine } from "@/lib/types/fnb";
import type { Shift } from "@/lib/types/shift";
import type { Customer } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useFnbPosState } from "./hooks/use-fnb-pos-state";
import { FnbHeader } from "./components/fnb-header";
import { FnbLoadingSkeleton } from "./components/fnb-loading-skeleton";
import { FnbEmptyBranch } from "./components/fnb-empty-branch";
import type { FnbCategory } from "./components/fnb-category-tabs";
import {
  FnbCategorySidebar,
  type FnbCategoryWithCount,
} from "./components/fnb-category-sidebar";
import { FnbCategoryGrid } from "./components/fnb-category-grid";
import { FnbSidenavDrawer } from "./components/fnb-sidenav-drawer";
import { PosPinSwitchDialog } from "@/components/shared/dialogs/pos-pin-switch-dialog";
import { FnbProductGrid, type FnbProduct } from "./components/fnb-product-grid";
import { FnbSubcategoryPills } from "./components/fnb-subcategory-pills";
import { FnbCart } from "./components/fnb-cart";
import type { FnbItemConfirmPayload, FnbItemInitialSelection } from "./components/fnb-item-dialog";
import type { FnbPaymentConfirmPayload } from "./components/fnb-payment-dialog";
import type { SplitItem } from "./components/split-bill-dialog";
import { ConnectionStatusBar } from "./components/connection-status-bar";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Lazy load heavy dialogs (only loaded when user opens them)
const FnbItemDialog = lazy(() => import("./components/fnb-item-dialog").then(m => ({ default: m.FnbItemDialog })));
const FnbPaymentDialog = lazy(() => import("./components/fnb-payment-dialog").then(m => ({ default: m.FnbPaymentDialog })));
const TableFloorPlan = lazy(() => import("./components/table-floor-plan").then(m => ({ default: m.TableFloorPlan })));
const SplitBillDialog = lazy(() => import("./components/split-bill-dialog").then(m => ({ default: m.SplitBillDialog })));
const OpenShiftDialog = lazy(() => import("./components/shift-dialog").then(m => ({ default: m.OpenShiftDialog })));
const CloseShiftDialog = lazy(() => import("./components/shift-dialog").then(m => ({ default: m.CloseShiftDialog })));
// CEO 05/06/2026: popup cảnh báo ca quên đóng — auto chuyển pending qua RPC.
const PendingShiftAlertSection = lazy(() =>
  import("@/components/shared/shift/pending-shift-alert").then((m) => ({
    default: m.PendingShiftAlertSection,
  })),
);
const FnbSearchModal = lazy(() => import("./components/fnb-search-modal").then(m => ({ default: m.FnbSearchModal })));
const FnbCustomerPicker = lazy(() => import("./components/fnb-customer-picker").then(m => ({ default: m.FnbCustomerPicker })));
const SyncQueueDrawer = lazy(() => import("./components/sync-queue-drawer").then(m => ({ default: m.SyncQueueDrawer })));
const FnbOrderHistoryDialog = lazy(() => import("./components/fnb-order-history-dialog").then(m => ({ default: m.FnbOrderHistoryDialog })));

function FnbPosPageInner() {
  const { user, tenant, currentBranch, branches, isLoading: authLoading, hasPermission } = useAuth();
  const { toast } = useToast();
  const { settings } = useSettings();
  const networkStatus = useNetworkStatus();
  const pos = useFnbPosState(currentBranch?.id);

  // ── Data state ──
  const [categories, setCategories] = useState<FnbCategory[]>([]);
  const [products, setProducts] = useState<FnbProduct[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  // POS-FIX-C2: Map orderId → createdAt cho TableFloorPlan timer.
  // Fetch khi showFloorPlan mở (lazy) để không block initial load.
  const [orderTimestamps, setOrderTimestamps] = useState<Record<string, string>>({});
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  // Sprint UI-4: sub-filter brand trong active category. null = "Tất cả".
  // Reset khi đổi category để không carry filter sai sang nhóm khác.
  const [activeSubFilter, setActiveSubFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Dialog state ──
  const [selectedProduct, setSelectedProduct] = useState<FnbProduct | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  // Phase 1A.2: nếu có giá trị → dialog đang ở chế độ Sửa của line này.
  // Confirm sẽ updateLine thay vì addLine. Reset khi đóng dialog hoặc
  // khi bắt đầu add mới (handleSelectProduct).
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [itemVariants, setItemVariants] = useState<{ id: string; label: string; sell_price: number }[]>([]);
  // POS-FIX-C3: track loading state cho variant dialog — khi cache miss
  // mà network đang fetch, hiện skeleton thay vì empty (UX "tưởng đơ").
  const [itemVariantsLoading, setItemVariantsLoading] = useState(false);
  // CEO 01/06/2026 — Sprint 2.2e: Dynamic modifier groups cho SP đang mở dialog.
  // Cache per-product để tránh re-fetch khi cashier quay lại cùng món.
  const [itemModifierData, setItemModifierData] = useState<
    DynamicModifierData | undefined
  >(undefined);
  const [toppingProducts, setToppingProducts] = useState<{ id: string; name: string; price: number }[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [showFloorPlan, setShowFloorPlan] = useState(false);
  const [splitBillOpen, setSplitBillOpen] = useState(false);
  const [splitItems, setSplitItems] = useState<SplitItem[]>([]);
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [openShiftDialogOpen, setOpenShiftDialogOpen] = useState(false);
  const [closeShiftDialogOpen, setCloseShiftDialogOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);
  const [orderHistoryOpen, setOrderHistoryOpen] = useState(false);
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  // R5: Lý do huỷ — bắt buộc để audit & loss prevention.
  const [voidReason, setVoidReason] = useState("");
  // Khi chọn "Khác" → bắt nhập chi tiết tự do để audit log có ngữ cảnh.
  const [voidReasonOther, setVoidReasonOther] = useState("");
  // Sprint S2 Phase 3a (CEO 12/05): OTP delegation cho cashier không có quyền
  // pos_fnb.cancel_unpaid_order. Cashier xin OTP từ quản lý qua điện thoại
  // → nhập vào dialog → server check OTP issuer có quyền.
  const [voidOtpDialogOpen, setVoidOtpDialogOpen] = useState(false);
  const [voidOtpContext, setVoidOtpContext] = useState<{
    orderId: string;
    label: string;
    reasonCode: string;
    tableId?: string | null;
  } | null>(null);
  const [transferTableOpen, setTransferTableOpen] = useState(false);
  // Sprint A — CEO 06/05: Sidenav drawer trigger từ ☰ button trong header.
  const [sidenavOpen, setSidenavOpen] = useState(false);
  // Sprint B.5 (CEO 12/05): PIN POS switch user dialog
  const [pinSwitchOpen, setPinSwitchOpen] = useState(false);
  // CEO 13/05: discount manual OTP dialog (BẤT KỲ giảm giá manual nào)
  const [discountOtpOpen, setDiscountOtpOpen] = useState(false);
  const pendingDiscountRef = useRef<(() => void) | null>(null);

  // CEO 13/05 (Fabi/iPos): platform price override map.
  // Key: productId, value: { shopee_food?: number, grab_food?: number, ... }
  // Load 1 lần khi mount + theo tab.deliveryPlatform → resolve giá đúng.
  const [platformPriceMap, setPlatformPriceMap] = useState<
    Record<string, Partial<Record<string, number>>>
  >({});
  // Sprint POS-FNB-EXT-1 (CEO 08/05): platform commission settings + discount presets
  const [platformSettings, setPlatformSettings] = useState<DeliveryPlatformSettings | null>(null);
  const [discountPresets, setDiscountPresets] = useState<DiscountPreset[]>([]);

  // Voucher / coupon state — áp mã khuyến mãi cho đơn hiện tại.
  // couponApplied null = chưa áp. Khi áp, set orderDiscount = { mode: amount, value: discount }.
  const [couponApplied, setCouponApplied] = useState<{ code: string; discount: number } | null>(null);
  const [couponApplying, setCouponApplying] = useState(false);

  const branchId = currentBranch?.id;
  const tenantId = tenant?.id ?? "";
  const isBlockingLoad = authLoading || (!!branchId && loading);

  // CEO 13/05: Auto-switch nếu user đang ở branch non-store (kho tổng/xưởng/
  // văn phòng). POS FnB chỉ phục vụ quán. Tìm quán đầu tiên trong list →
  // switch + toast info. Tránh user bị stuck với cart trống không add món
  // được vì branch không match menu FnB.
  const { switchBranch: doSwitchBranch } = useAuth();
  // Guard: chỉ auto-switch + toast MỘT lần/mount. Tránh bắn lặp khi
  // currentBranch/branches đổi reference trước lúc switch hoàn tất.
  const hasAutoSwitchedRef = useRef(false);
  useEffect(() => {
    if (authLoading) return;
    if (!currentBranch) return;
    if (currentBranch.branchType === "store") return;
    if (hasAutoSwitchedRef.current) return;
    const firstStore = branches.find((b) => b.branchType === "store");
    if (!firstStore) {
      // Không có quán FnB nào → FnbEmptyBranch sẽ render
      return;
    }
    hasAutoSwitchedRef.current = true;
    void doSwitchBranch(firstStore.id);
    toast({
      title: "Chuyển sang quán FnB",
      description: `${currentBranch.name} là ${
        currentBranch.branchType === "warehouse"
          ? "kho tổng"
          : currentBranch.branchType === "factory"
            ? "xưởng sản xuất"
            : "văn phòng"
      } — POS FnB tự chuyển sang "${firstStore.name}". Bấm dropdown chi nhánh để đổi quán khác.`,
      variant: "info",
      duration: 5000,
    });
  }, [authLoading, currentBranch, branches, doSwitchBranch, toast]);
  const [blockingLoadMs, setBlockingLoadMs] = useState(0);

  useEffect(() => {
    if (!isBlockingLoad) {
      setBlockingLoadMs(0);
      return;
    }

    const startedAt = Date.now();
    setBlockingLoadMs(0);
    const interval = window.setInterval(() => {
      setBlockingLoadMs(Date.now() - startedAt);
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [isBlockingLoad, branchId, tenantId]);

  const retryFnbLoad = useCallback(() => {
    window.location.reload();
  }, []);

  // Sprint 2: Tier áp dụng cho POS FnB của chi nhánh này.
  // Resolve khi branchId hoặc products đổi → priceMap + override sell_price.
  const [appliedTier, setAppliedTier] = useState<{
    tierId: string;
    tierName: string;
    tierCode: string;
    priceMap: Map<string, number>;
  } | null>(null);
  const userId = user?.id ?? "";
  const canCancelUnpaidOrder =
    hasPermission(PERMISSIONS.POS_FNB_CANCEL_UNPAID_ORDER) ||
    hasPermission(PERMISSIONS.POS_FNB_VOID);
  // Day 1 16/05: Tách permission void bill ĐÃ thanh toán riêng — không gộp với
  // "cancel_unpaid_order" vì void paid phải hoàn kho + tạo phiếu chi.
  const canVoidPaidBill =
    hasPermission(PERMISSIONS.POS_FNB_VOID_PAID_BILL) ||
    hasPermission(PERMISSIONS.POS_FNB_VOID);

  // ── Load data (cache-first, then network refresh) ──
  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      setLoading(true);
      try {
        // Step 1: Load from IndexedDB cache instantly
        try {
          const cached = await getMenuFromCache(tenantId);
          if (cached.products.length > 0) {
            setCategories(cached.categories);
            setProducts(cached.products);
            setToppingProducts(cached.toppings);
            setLoading(false); // Show cached data immediately
          }
          if (branchId) {
            const cachedTables = await getTablesFromCache(tenantId, branchId);
            if (cachedTables.length > 0) {
              setTables(cachedTables as RestaurantTable[]);
            }
          }
        } catch {
          // IndexedDB not available — continue with network
        }

        // Step 2: Background refresh from Supabase (if online) — PARALLEL
        if (networkStatus.isOnline) {
          const needsRefresh = await shouldRefreshMenu(tenantId).catch(() => true);
          const supabase = getClient();

          // Parallel fetch: catalog (cats + products + toppings + platform_prices) + branch-scoped (tables + shift)
          const catalogPromise = needsRefresh
            ? Promise.all([
                // CEO 04/05: chỉ load categories có SP FnB → POS FnB không
                // còn thấy category retail (Cốc giấy, Bột cacao đóng gói...).
                getProductCategoriesAsync("sku", "fnb"),
                supabase
                  .from("products")
                  .select("id, name, code, sell_price, image_url, stock, category_id, brand")
                  .eq("tenant_id", tenantId)
                  .eq("is_active", true)
                  .eq("product_type", "sku")
                  .eq("channel", "fnb")
                  .order("name")
                  .limit(5000), // CEO 12/05: bỏ giới hạn 200 SP — product grid đã virtualize (@tanstack/react-virtual) nên DOM safe; payload ~1MB cho 5000 SP, mạng 4G ~1-2s, chấp nhận được. Cap 5000 để tránh Supabase PostgREST default cap.
                supabase
                  .from("products")
                  .select("id, name, sell_price")
                  .eq("tenant_id", tenantId)
                  .eq("is_active", true)
                  .ilike("code", "NVL-TOP%")
                  .limit(1000), // tương tự — tăng từ 100 lên 1000 cho toppings
                // CEO 13/05: load platform price overrides để resolve giá theo
                // tab.deliveryPlatform. Map sang Record<productId, Record<platform, price>>.
                supabase
                  .from("product_platform_prices")
                  .select("product_id, platform, override_price")
                  .eq("tenant_id", tenantId),
              ])
            : Promise.resolve(null);

          const tablesPromise = branchId
            ? getTablesByBranch(branchId).catch(() => [] as RestaurantTable[])
            : Promise.resolve([] as RestaurantTable[]);

          const shiftPromise = branchId && userId
            ? getOpenShift(branchId, userId).catch(() => null)
            : Promise.resolve(null);

          const [catalogResult, tbls, shift] = await Promise.all([
            catalogPromise,
            tablesPromise,
            shiftPromise,
          ]);

          if (catalogResult) {
            const [cats, prodsResp, toppingsResp, ppResp] = catalogResult;
            // CEO 13/05: build platform price map → resolve nhanh trong POS
            const ppMap: Record<string, Partial<Record<string, number>>> = {};
            for (const row of ppResp?.data ?? []) {
              const r = row as Record<string, unknown>;
              const pid = String(r.product_id);
              if (!ppMap[pid]) ppMap[pid] = {};
              ppMap[pid][String(r.platform)] = Number(r.override_price);
            }
            setPlatformPriceMap(ppMap);
            const mappedCats = cats.map((c) => ({
              id: c.value,
              name: c.label,
              code: c.value,
            }));
            setCategories(mappedCats);

            const prods = prodsResp.data ?? [];
            setProducts(
              prods.map((p) => ({
                id: p.id,
                name: p.name,
                code: p.code,
                sell_price: p.sell_price,
                image_url: (p as Record<string, unknown>).image_url as string | undefined,
                stock: p.stock,
                category_id: p.category_id,
                brand: ((p as Record<string, unknown>).brand as string | null) ?? null,
              }))
            );

            const toppings = toppingsResp.data ?? [];
            setToppingProducts(
              toppings.map((t) => ({
                id: t.id,
                name: t.name,
                price: t.sell_price,
              }))
            );

            // Update cache in background — fail OK, retry next session.
            prefetchMenuData(tenantId).catch((err) =>
              console.warn("[FnB] prefetchMenuData failed:", err),
            );
          }

          if (branchId) {
            setTables(tbls);
            prefetchTableData(tenantId, branchId).catch((err) =>
              console.warn("[FnB] prefetchTableData failed:", err),
            );
            if (userId) setCurrentShift(shift);
          }
        }
      } catch (err) {
        // Nếu đã có cached data → chỉ cảnh báo nhẹ, không block UI.
        // Nếu chưa có gì → toast lỗi để nhân viên biết menu có thể cũ.
        console.error("FnB data load error:", err);
        toast({
          title: "Không tải được dữ liệu mới",
          description:
            networkStatus.isOnline
              ? "Đang dùng menu đã lưu. Thử tải lại trang nếu thiếu món."
              : "Đang offline — dùng menu đã cache.",
          variant: "warning",
        });
      } finally {
        setLoading(false);
      }
    })();
    // Bỏ `toast` khỏi deps — nếu ToastContext re-render, tham chiếu đổi →
    // init flow re-run → 2000+ rows products + variants refetch → POS treo.
    // toast chỉ dùng trong catch path, ref vẫn đúng tại thời điểm fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, branchId, networkStatus.isOnline]);

  // Sprint POS-FNB-EXT-1 (CEO 08/05): Load delivery platform settings +
  // discount presets on mount. Cached suốt session — F5 reload.
  useEffect(() => {
    let cancelled = false;
    Promise.all([getDeliveryPlatformSettings(), getDiscountPresets()])
      .then(([p, pr]) => {
        if (cancelled) return;
        setPlatformSettings(p);
        setDiscountPresets(pr);
      })
      .catch(() => {
        // Silent — fallback empty
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Day 21/05/2026 (CEO): load shipper list + delivery fee tiers + count today
  const [shipperOptions, setShipperOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [deliveryTiers, setDeliveryTiers] = useState<
    { code: "near" | "mid" | "far"; label: string; fee: number }[]
  >([]);
  const [deliveryCountToday, setDeliveryCountToday] = useState<number>(0);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    void (async () => {
      try {
        const services = await import("@/lib/services");
        const [pinUsers, tiers, count] = await Promise.all([
          services.listPosPinUsers(branchId),
          services.getDeliveryFeeTiersForBranch(branchId),
          services.getDeliveryCountToday(branchId),
        ]);
        if (cancelled) return;
        setShipperOptions(
          pinUsers
            .filter((u) => !u.isLocked)
            .map((u) => ({ id: u.id, name: u.fullName })),
        );
        setDeliveryTiers(
          tiers
            .filter((t) => t.tierCode !== undefined)
            .map((t) => ({
              code: t.tierCode,
              label: t.tierLabel,
              fee: t.fee,
            })),
        );
        setDeliveryCountToday(count);
      } catch (err) {
        console.warn("[FnbPOS] load shipper/tiers/count failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  // Refresh count delivery hôm nay mỗi 60s — không real-time critical
  useEffect(() => {
    if (!branchId) return;
    const iv = setInterval(() => {
      void (async () => {
        try {
          const services = await import("@/lib/services");
          const count = await services.getDeliveryCountToday(branchId);
          setDeliveryCountToday(count);
        } catch {
          /* silent */
        }
      })();
    }, 60000);
    return () => clearInterval(iv);
  }, [branchId]);

  // Sprint FIX-1 (CEO 07/05): Listen "fnb-print-failed" event từ print-fnb.ts
  // → toast lỗi để user biết không in được. Toggle qua settings.print.notifyPrintFailure.
  useEffect(() => {
    if (!settings.print.notifyPrintFailure) return;
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ reason: string; message: string }>;
      const detail = custom.detail;
      toast({
        title: "Không in được phiếu",
        description: detail?.message ?? "Kiểm tra lại máy in / popup trình duyệt.",
        variant: "error",
        duration: 5000,
      });
    };
    window.addEventListener("fnb-print-failed", handler);
    return () => window.removeEventListener("fnb-print-failed", handler);
  }, [settings.print.notifyPrintFailure, toast]);

  // POS-FIX-C2: Fetch order timestamps cho floor plan timer khi mở floor plan.
  // Refresh mỗi 60s để timer cập nhật mượt khi user xem lâu.
  useEffect(() => {
    if (!showFloorPlan || !branchId) return;
    let cancelled = false;
    const fetchTimestamps = async () => {
      try {
        const orders = await getKitchenOrders(branchId, [
          "pending",
          "preparing",
          "ready",
          "served",
        ]);
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const o of orders) {
          map[o.id] = o.createdAt;
        }
        setOrderTimestamps(map);
      } catch (err) {
        console.error("[FnB] fetch orderTimestamps failed:", err);
      }
    };
    fetchTimestamps();
    const interval = setInterval(fetchTimestamps, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showFloorPlan, branchId]);

  // POS-FIX-B2: Reset cart khi đổi branch (bỏ qua mount đầu tiên).
  // Tránh gửi cart từ quán A sang quán B — productId có thể không tồn tại
  // ở B hoặc bếp B pha sai món của A.
  const prevBranchIdRef = useRef<string | undefined>(branchId);
  useEffect(() => {
    if (prevBranchIdRef.current && prevBranchIdRef.current !== branchId) {
      // Branch thực sự đổi (không phải mount đầu)
      pos.resetAllTabs();
      toast({
        title: "Đã chuyển chi nhánh",
        description: "Cart đã được làm sạch để tránh gửi nhầm đơn.",
        variant: "default",
        duration: 3000,
      });
    }
    prevBranchIdRef.current = branchId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // productsWithTier: products với sell_price override theo tier áp dụng cho
  // chi nhánh hiện tại. Mọi UI render menu (grid + search modal + item dialog
  // nếu base product) dùng list này thay vì products thô.
  // Variant prices KHÔNG override (variant có giá riêng từ DB).
  const productsWithTier = useMemo(() => {
    if (!appliedTier) return products;
    return products.map((p) => {
      const tierPrice = appliedTier.priceMap.get(p.id);
      return tierPrice !== undefined ? { ...p, sell_price: tierPrice } : p;
    });
  }, [products, appliedTier]);

  // ============================================================
  // Sprint KM-2: Promotion engine cho POS FnB
  // ============================================================
  // Theo dõi activeTab.lines + branchId + customerId → resolve KM tốt nhất.
  // Mỗi tab có thể có KM riêng (vì cart khác nhau). Khi switch tab, useEffect
  // re-fire và resolve lại cho tab mới.
  const [appliedPromotion, setAppliedPromotion] = useState<AppliedPromotion | null>(null);
  const [promotionCleared, setPromotionCleared] = useState(false);

  const activeTabLines = pos.activeTab?.lines ?? [];
  const activeTabSubtotal = pos.subtotal;
  const activeTabCustomerId = pos.activeTab?.customerId;

  useEffect(() => {
    if (!branchId || !pos.activeTabId) return;
    if (promotionCleared) return;

    if (activeTabLines.length === 0) {
      if (appliedPromotion) {
        setAppliedPromotion(null);
        pos.setOrderDiscount(pos.activeTabId, undefined);
      }
      return;
    }

    let cancelled = false;
    // Build cart items với categoryId từ products lookup (cho KM theo nhóm)
    const productCategoryMap = new Map(products.map((p) => [p.id, p.category_id ?? null]));
    const items = activeTabLines.map((l) => ({
      productId: l.productId,
      categoryId: productCategoryMap.get(l.productId) ?? null,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    }));

    resolveAppliedPromotion({
      channel: "fnb",
      branchId,
      customerId: activeTabCustomerId ?? null,
      items,
    })
      .then(({ best }) => {
        if (cancelled) return;
        if (!best || best.discountAmount <= 0) {
          if (appliedPromotion) {
            setAppliedPromotion(null);
            if (pos.activeTabId) pos.setOrderDiscount(pos.activeTabId, undefined);
          }
          return;
        }
        if (appliedPromotion?.promotion.id !== best.promotion.id) {
          setAppliedPromotion(best);
          if (pos.activeTabId) {
            pos.setOrderDiscount(pos.activeTabId, {
              mode: "amount",
              value: best.discountAmount,
            });
          }
          toast({
            title: `Áp dụng khuyến mãi: ${best.promotion.name}`,
            description: `${best.reasonLabel} — Giảm ${formatCurrency(best.discountAmount)}đ`,
            variant: "success",
          });
        } else if (appliedPromotion.discountAmount !== best.discountAmount) {
          setAppliedPromotion(best);
          if (pos.activeTabId) {
            pos.setOrderDiscount(pos.activeTabId, {
              mode: "amount",
              value: best.discountAmount,
            });
          }
        }
      })
      .catch(() => {
        if (appliedPromotion) {
          setAppliedPromotion(null);
          if (pos.activeTabId) pos.setOrderDiscount(pos.activeTabId, undefined);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pos.activeTabId,
    activeTabLines.length,
    activeTabSubtotal,
    activeTabCustomerId,
    branchId,
    promotionCleared,
  ]);

  // Khi switch tab → reset cleared flag (mỗi tab có "session" riêng)
  useEffect(() => {
    setPromotionCleared(false);
  }, [pos.activeTabId]);

  function clearAppliedPromotion() {
    if (!pos.activeTabId) return;
    setAppliedPromotion(null);
    setPromotionCleared(true);
    pos.setOrderDiscount(pos.activeTabId, undefined);
  }

  // ── Filtered products (Sprint UI-4: thêm sub-filter brand) ──
  const productsInCategory = useMemo(() => {
    if (!activeCategoryId) return productsWithTier;
    return productsWithTier.filter((p) => p.category_id === activeCategoryId);
  }, [productsWithTier, activeCategoryId]);

  const filteredProducts = useMemo(() => {
    if (!activeSubFilter) return productsInCategory;
    return productsInCategory.filter((p) => p.brand === activeSubFilter);
  }, [productsInCategory, activeSubFilter]);

  // Map productId → tổng qty đang trong giỏ của tab hiện tại. Pass xuống
  // FnbProductGrid để render badge số lượng trên ô món (Phase 1A — additive,
  // không đổi flow). Cộng dồn nhiều line cùng productId (vd món có topping
  // khác ở line riêng) để cashier thấy tổng số đã chọn.
  const cartQtyByProductId = useMemo(() => {
    const map: Record<string, number> = {};
    const lines = pos.activeTab?.lines ?? [];
    for (const l of lines) {
      map[l.productId] = (map[l.productId] ?? 0) + l.quantity;
    }
    return map;
  }, [pos.activeTab?.lines]);

  // Map productId → brand cho sub-pills component (chỉ products trong category)
  const brandByProductId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const p of productsInCategory) {
      map.set(p.id, p.brand ?? null);
    }
    return map;
  }, [productsInCategory]);

  // Active category name từ id (cho UI-4 pills label)
  const activeCategoryName = useMemo(() => {
    if (!activeCategoryId) return null;
    return categories.find((c) => c.id === activeCategoryId)?.name ?? null;
  }, [activeCategoryId, categories]);

  // Reset sub-filter khi đổi category (tránh filter brand cũ trên nhóm mới)
  useEffect(() => {
    setActiveSubFilter(null);
  }, [activeCategoryId]);

  // Sprint A: categories kèm count cho sidebar. Đếm trực tiếp từ products
  // hiện tại (không từ DB) — phản ánh đúng số SP user đang thấy.
  const categoriesWithCount = useMemo<FnbCategoryWithCount[]>(() => {
    const counts = new Map<string, number>();
    for (const p of productsWithTier) {
      if (p.category_id) {
        counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
      }
    }
    return categories.map((c) => ({
      ...c,
      count: counts.get(c.id) ?? 0,
    }));
  }, [categories, productsWithTier]);

  // ── Variant cache (in-memory, per session) — tránh refetch khi user mở lại dialog cùng SP.
  //    Warm từ IndexedDB on mount (effect bên dưới) → dialog mở instant NGAY CẢ
  //    khi offline hoặc trong lúc prefetch network chưa xong. ──
  const variantCacheRef = useMemo(
    () => new Map<string, { id: string; label: string; sell_price: number }[]>(),
    []
  );

  // CEO 01/06/2026 — Sprint 2.2e: Cache modifier data per (productId, categoryId).
  // Key dùng productId vì SP có thể có override (product-level) hoặc inherit
  // (category-level). Cùng SP → cùng modifier (đến khi setup thay đổi).
  // Empty array (no groups) cũng cache để tránh re-fetch SP không có modifier.
  const modifierCacheRef = useMemo(
    () => new Map<string, DynamicModifierData>(),
    []
  );

  // Helper: load modifier groups + options effective cho SP.
  // CACHE-FIRST: kiểm cache trước, miss thì fetch + lưu cache.
  const loadModifierForProduct = useCallback(
    async (productId: string, categoryId: string | null) => {
      const cached = modifierCacheRef.get(productId);
      if (cached) return cached;
      try {
        const groups = await getEffectiveModifierGroupsForProduct(
          productId,
          categoryId,
        );
        const optionsByGroup = new Map<string, ModifierOption[]>();
        await Promise.all(
          groups.map(async (g) => {
            const opts = await listModifierOptions(g.id);
            optionsByGroup.set(g.id, opts);
          }),
        );
        const data: DynamicModifierData = { groups, optionsByGroup };
        modifierCacheRef.set(productId, data);
        return data;
      } catch (err) {
        console.warn("loadModifierForProduct error:", err);
        const empty: DynamicModifierData = {
          groups: [],
          optionsByGroup: new Map(),
        };
        modifierCacheRef.set(productId, empty);
        return empty;
      }
    },
    [modifierCacheRef],
  );

  // ── Warm variant cache từ IndexedDB ngay khi mount (cache-first).
  //    Chạy 1 lần, không chờ network. Nếu có data → dialog mở instant trên cold
  //    start + offline reload. Sau đó effect prefetch bên dưới sẽ refresh nếu
  //    cache stale (>30 phút) và online. ──
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const cached = await getVariantsFromCache(tenantId);
        if (cancelled) return;
        cached.forEach((variants, pid) => {
          // Chỉ set nếu chưa có trong ref (tránh overwrite fresh network data)
          if (!variantCacheRef.has(pid)) {
            variantCacheRef.set(pid, variants);
          }
        });
      } catch {
        // Silent — IndexedDB có thể unavailable (SSR/private mode)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, variantCacheRef]);

  // ── Variant PREFETCH: batch load variants cho TẤT CẢ SP NGAY SAU khi products load.
  //    Mục đích: click SP bất kỳ → dialog mở instant (0 round-trip network).
  //    Gate bằng requestIdleCallback → không block first paint.
  //    Skip nếu cache IndexedDB còn fresh (<30 phút) → tiết kiệm 500 queries.
  //    Sau khi fetch xong → persist vào IndexedDB để reload sau không phải refetch. ──
  useEffect(() => {
    if (!networkStatus.isOnline) return;
    if (!tenantId) return;
    if (products.length === 0) return;

    let cancelled = false;

    const runPrefetch = async () => {
      if (cancelled) return;

      // Nếu cache IndexedDB còn tươi + đã khớp phần lớn products trong ref
      // → skip fetch network (đã warm từ effect trên).
      try {
        const fresh = !(await shouldRefreshVariants(tenantId));
        if (fresh && variantCacheRef.size >= products.length * 0.8) {
          return;
        }
      } catch {
        // Fall through → vẫn fetch để fail-safe
      }

      if (cancelled) return;

      // Fetch TẤT CẢ products — getVariantsByProductIds dùng `in()` filter
      // nên 500 ids = 1 query duy nhất, rất nhanh.
      const allIds = products.map((p) => p.id);

      try {
        const variantMap = await getVariantsByProductIds(allIds);
        if (cancelled) return;

        // Ghi vào in-memory ref cho session hiện tại
        variantMap.forEach((variants, pid) => {
          variantCacheRef.set(
            pid,
            variants.map((v) => ({
              id: v.id,
              label: v.name,
              sell_price: v.sellPrice,
            }))
          );
        });

        // Persist vào IndexedDB → lần vào trang sau (cold start, reload, offline)
        // chỉ cần đọc cache là có full variants, không cần hit network.
        const toPersist = new Map<
          string,
          { id: string; label: string; sell_price: number }[]
        >();
        variantMap.forEach((variants, pid) => {
          toPersist.set(
            pid,
            variants.map((v) => ({
              id: v.id,
              label: v.name,
              sell_price: v.sellPrice,
            }))
          );
        });
        saveVariantsToCache(tenantId, toPersist).catch(() => {
          // Silent — quota full hoặc DB lỗi → session memory cache vẫn dùng được
        });
      } catch {
        // Silent — lazy fetch on click sẽ backfill cache
      }
    };

    // requestIdleCallback: browser fire khi main thread idle → không block
    // first paint + interactive. Fallback setTimeout 1s trên Safari (<16.4).
    if (typeof window === "undefined") return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cic = (window as any).cancelIdleCallback as
      | ((id: number) => void)
      | undefined;

    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;
    if (ric) {
      idleHandle = ric(runPrefetch, { timeout: 2000 });
    } else {
      timeoutHandle = window.setTimeout(runPrefetch, 1000);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== undefined && cic) cic(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, [products, networkStatus.isOnline, tenantId, variantCacheRef]);

  // ── Sprint 2: Resolve tier áp dụng cho POS FnB của chi nhánh ──
  // Khi branchId + products đã load → fetch tier mặc định của chi nhánh +
  // priceMap. Dùng để override sell_price khi render menu (qua displayProducts
  // useMemo dưới). Tier change → cart lines hiện tại KHÔNG re-price (đơn
  // đã thêm giữ giá cũ — pattern POS chuẩn để cashier không bị bất ngờ).
  useEffect(() => {
    if (!branchId || products.length === 0) {
      setAppliedTier(null);
      return;
    }
    let cancelled = false;
    const productIds = products.map((p) => p.id);
    resolveAppliedTier({
      channel: "fnb",
      branchId,
      productIds,
    })
      .then((tier) => {
        if (!cancelled) setAppliedTier(tier);
      })
      .catch(() => {
        if (!cancelled) setAppliedTier(null);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, products]);

  // ── Product select → quick-add hoặc open item dialog ──
  // Sprint POS-FNB-3 (CEO 06/05): SP đơn giản (không variant) → 1-tap add
  // cart, KHÔNG mở dialog. Pattern KiotViet: cà phê đen / nước suối / bánh
  // mỳ chỉ cần click 1 lần → vào giỏ ngay, save 4 tap so với dialog.
  // Nếu khách muốn thêm topping / ghi chú → click edit từ cart line.
  const handleSelectProduct = useCallback(
    async (product: FnbProduct) => {
      hapticTap();
      // Phase 1A.2: clear edit-mode trước khi mở dialog cho add mới,
      // tránh confirm rơi nhầm nhánh updateLine.
      setEditingLineId(null);
      setSelectedProduct(product);

      // Helper: quick-add với product price chuẩn (không variant, không topping)
      // CEO 13/05: resolve giá theo tab.deliveryPlatform — nếu có override
      // cho platform của tab hiện tại (vd shopee_food = 26k) thì dùng, else
      // fallback sell_price (25k).
      const activeTab = pos.activeTab;
      const platform = activeTab?.deliveryPlatform;
      const override = platform && platform !== "direct"
        ? platformPriceMap[product.id]?.[platform]
        : undefined;
      const resolvedPrice = override !== undefined ? override : product.sell_price;

      const quickAdd = () => {
        pos.addLine({
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: resolvedPrice,
          toppings: [],
        });
        const overrideNote = override !== undefined
          ? ` (giá ${platform === "shopee_food" ? "Shopee Food" : platform === "grab_food" ? "Grab" : platform})`
          : "";
        toast({
          title: `+1 ${product.name}`,
          description: `${formatCurrency(resolvedPrice)}đ${overrideNote} — vào giỏ ngay`,
          variant: "success",
          duration: 1500,
        });
      };

      // CEO 01/06/2026 — Sprint 2.2e: load modifier groups song song với variants.
      // Cache-first → instant response cho SP đã mở trước. Cache miss thì fetch.
      void loadModifierForProduct(product.id, product.category_id).then(
        (data) => {
          setItemModifierData(data);
        },
      );

      // 1. Cache hit — quyết định ngay không network
      const cached = variantCacheRef.get(product.id);
      if (cached) {
        if (cached.length === 0) {
          // SP không có biến thể NHƯNG có thể có modifier → check modifier cache
          const modCached = modifierCacheRef.get(product.id);
          if (modCached && modCached.groups.length > 0) {
            // Có modifier → mở dialog dù không có size
            setItemVariants([]);
            setItemDialogOpen(true);
            return;
          }
          // Không variant + không modifier → quick-add, skip dialog
          quickAdd();
          return;
        }
        // SP có ≥1 biến thể → mở dialog cho user chọn size
        setItemVariants(cached);
        setItemDialogOpen(true);
        return;
      }

      // 2. Cache miss → fetch variants. Mở dialog ngay với loading state
      // để user thấy phản hồi tức thời. Nếu sau fetch ra 0 variants →
      // close dialog + quick-add.
      setItemVariants([]);
      setItemVariantsLoading(true);
      setItemDialogOpen(true);
      try {
        const variants = await getVariantsByProduct(product.id);
        const mapped = variants.map((v) => ({
          id: v.id,
          label: v.name,
          sell_price: v.sellPrice,
        }));
        variantCacheRef.set(product.id, mapped);

        if (mapped.length === 0) {
          // Không có variant — chờ modifier load xong rồi quyết định:
          // có modifier groups → giữ dialog mở; không có → quick-add.
          const modData = await loadModifierForProduct(
            product.id,
            product.category_id,
          );
          if (modData.groups.length === 0) {
            setItemDialogOpen(false);
            quickAdd();
            return;
          }
        }
        setItemVariants(mapped);
      } catch (err) {
        console.error("getVariantsByProduct error:", err);
        setItemVariants([]);
        toast({
          title: "Không tải được size/biến thể",
          description: "Món sẽ được thêm với giá chuẩn.",
          variant: "warning",
        });
      } finally {
        setItemVariantsLoading(false);
      }
    },
    [toast, variantCacheRef, modifierCacheRef, loadModifierForProduct, pos],
  );

  // ── Add to cart from item dialog ──
  const handleItemConfirm = useCallback(
    (payload: FnbItemConfirmPayload) => {
      const linePayload = {
        productId: payload.productId,
        productName: payload.productName,
        variantId: payload.variantId,
        variantLabel: payload.variantLabel,
        quantity: payload.quantity,
        unitPrice: payload.unitPrice,
        toppings: payload.toppings,
        // CEO 01/06/2026 — Sprint 2.3a: lưu snapshot modifier vào cart line.
        // RPC checkout (Sprint 2.3b) sẽ đọc snapshot này để scale BOM + trừ
        // tồn topping NVL.
        modifierSelections: payload.modifierSelections,
        note: payload.note,
      };
      if (editingLineId) {
        // Phase 1A.2: chế độ Sửa — cập nhật đúng vị trí, không xoá-thêm.
        pos.updateLine(editingLineId, linePayload);
        setEditingLineId(null);
      } else {
        pos.addLine(linePayload);
      }
      setItemDialogOpen(false);
    },
    [pos, editingLineId]
  );

  // Phase 1A.2: mở lại item dialog ở chế độ Sửa cho 1 line cụ thể.
  // Tải variants từ cache (cùng cơ chế handleSelectProduct), set
  // editingLineId để confirm rơi vào nhánh updateLine.
  const handleEditLine = useCallback(
    async (line: FnbOrderLine) => {
      hapticTap();
      const product = products.find((p) => p.id === line.productId);
      if (!product) {
        toast({
          title: "Không tìm thấy món",
          description: "Có thể món đã bị xoá khỏi thực đơn.",
          variant: "warning",
        });
        return;
      }
      setEditingLineId(line.id);
      setSelectedProduct(product);

      // CEO 01/06/2026 — Sprint 2.2e: load modifier khi sửa dòng giỏ.
      void loadModifierForProduct(product.id, product.category_id).then(
        (data) => {
          setItemModifierData(data);
        },
      );

      const cached = variantCacheRef.get(line.productId);
      if (cached) {
        setItemVariants(cached);
        setItemDialogOpen(true);
        return;
      }
      setItemVariants([]);
      setItemVariantsLoading(true);
      setItemDialogOpen(true);
      try {
        const vs = await getVariantsByProduct(line.productId);
        const mapped = vs.map((v) => ({
          id: v.id,
          label: v.name,
          sell_price: v.sellPrice,
        }));
        variantCacheRef.set(line.productId, mapped);
        setItemVariants(mapped);
      } catch (err) {
        console.error("getVariantsByProduct error (edit):", err);
      } finally {
        setItemVariantsLoading(false);
      }
    },
    [products, toast, variantCacheRef, loadModifierForProduct]
  );

  // Compute initial selection for dialog when editing.
  const dialogInitialSelection: FnbItemInitialSelection | undefined = useMemo(() => {
    if (!editingLineId) return undefined;
    const line = pos.activeTab?.lines.find((l) => l.id === editingLineId);
    if (!line) return undefined;
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      toppings: line.toppings.map((t) => ({ id: t.productId, quantity: t.quantity })),
      // CEO 01/06/2026 — Sprint 2.3a: restore dynamic choices khi sửa line cũ.
      modifierSelections: line.modifierSelections,
      note: line.note,
    };
  }, [editingLineId, pos.activeTab?.lines]);

  // ── Send to kitchen (offline-aware) ──
  // - Nếu tab chưa có kitchenOrderId → tạo đơn bếp mới (sendToKitchen)
  // - Nếu tab đã có kitchenOrderId → gửi bổ sung (addItemsToExistingOrder)
  const handleSendToKitchen = useCallback(async (): Promise<string | null> => {
    const tab = pos.activeTab;
    if (!tab || tab.lines.length === 0) return null;

    const mappedItems = tab.lines.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      variantId: l.variantId,
      variantLabel: l.variantLabel,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      note: l.note,
      toppings: l.toppings.map((t) => ({
        productId: t.productId,
        name: t.name,
        quantity: t.quantity,
        price: t.price,
      })),
      // CEO 01/06/2026 — Sprint 2.3a: snapshot modifier choices truyền xuống
      // RPC. v1 RPC bỏ qua (backward compat), v2 (migration 00122) sẽ scale
      // BOM + trừ tồn topping NVL theo data này.
      modifierSelections: l.modifierSelections,
    }));

    try {
      const isAddItems = !!tab.kitchenOrderId;

      if (isAddItems) {
        // ── Gửi bổ sung vào đơn đã tồn tại ──
        await offlineAddItemsToExistingOrder(
          tab.kitchenOrderId!,
          mappedItems,
          networkStatus.isOnline
        );

        // In ticket bổ sung (đánh dấu "BỔ SUNG") — Sprint KITCHEN-1: split
        // theo station, mỗi station 1 phiếu với header lớn (BAR / BẾP / ...).
        if (settings.print.autoPrintKitchen && branchId) {
          await printKitchenTicketsByStation(
            tab.lines.map((l) => ({
              productId: l.productId,
              productName: l.productName,
              variantLabel: l.variantLabel,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              toppings: l.toppings.map((t) => ({
                name: t.name,
                quantity: t.quantity,
                price: t.price,
              })),
              // CEO 01/06/2026 — Sprint 2.4b: in modifier choices lên phiếu bếp.
              modifierLabels: l.modifierSelections?.map(
                (s) => `${s.groupName}: ${s.options.map((o) => o.label).join("/")}`,
              ),
              note: l.note,
            })),
            {
              orderNumber: tab.label,
              tableName: tab.label,
              orderType: tab.orderType,
              createdAt: new Date().toISOString(),
              cashierName: user?.fullName,
              style: settings.print.kitchenTicketStyle,
              paperSize: settings.print.paperSize === "58mm" ? "58mm" : "80mm",
              isOffline: !networkStatus.isOnline,
              isSupplement: true,
            },
            branchId,
          );
        }

        pos.clearCart();
        hapticSuccess();

        const extraCount = mappedItems.length;
        if (!networkStatus.isOnline) {
          toast({
            title: "Đã lưu ngoại tuyến",
            description: `${extraCount} món bổ sung sẽ đồng bộ khi có mạng`,
            variant: "default",
          });
        } else {
          toast({
            title: "Đã gửi thêm món",
            description: `${extraCount} món đã được gửi bếp bổ sung cho ${tab.label}`,
            variant: "success",
          });
        }
        return tab.kitchenOrderId ?? null;
      }

      // ── Tạo đơn bếp mới ──
      // Sprint POS-FNB-EXT-1: pass orderNote + delivery platform metadata.
      // Migration 00070: param đúng tên là `platformCommissionPercent` (%).
      const result = await offlineSendToKitchen({
        tenantId,
        branchId: branchId!,
        createdBy: userId,
        tableId: tab.tableId,
        orderType: tab.orderType,
        note: tab.orderNote,
        deliveryPlatform: tab.deliveryPlatform,
        deliveryFee: tab.deliveryFee,
        platformCommissionPercent: tab.platformCommissionPercent,
        // Day 21/05/2026 (CEO): shipper + tier km
        deliveryStaffId: tab.deliveryStaffId ?? null,
        deliveryDistanceTier: tab.deliveryDistanceTier ?? null,
        items: mappedItems,
      }, networkStatus.isOnline);

      pos.updateTabMeta(tab.id, { kitchenOrderId: result.kitchenOrderId });

      // Print kitchen ticket — Sprint KITCHEN-1: split theo station, mỗi
      // station 1 phiếu (Bar / Bếp / Quầy bánh...). Backward compat: tenant
      // chỉ có 1 station "Bar pha chế" → in 1 phiếu y hệt cũ.
      if (settings.print.autoPrintKitchen && branchId) {
        await printKitchenTicketsByStation(
          tab.lines.map((l) => ({
            productId: l.productId,
            productName: l.productName,
            variantLabel: l.variantLabel,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            toppings: l.toppings.map((t) => ({
              name: t.name,
              quantity: t.quantity,
              price: t.price,
            })),
            note: l.note,
          })),
          {
            orderNumber: result.orderNumber ?? "—",
            tableName: tab.label,
            orderType: tab.orderType,
            createdAt: new Date().toISOString(),
            cashierName: user?.fullName,
            style: settings.print.kitchenTicketStyle,
            paperSize: settings.print.paperSize === "58mm" ? "58mm" : "80mm",
            isOffline: !networkStatus.isOnline,
            orderNote: tab.orderNote, // Sprint POS-FNB-EXT-1: in ghi chú đơn ra phiếu
          },
          branchId,
        );
      }

      pos.clearCart();
      hapticSuccess();

      if (!networkStatus.isOnline) {
        toast({ title: "Đã lưu ngoại tuyến", description: `Đơn ${result.orderNumber} sẽ đồng bộ khi có mạng`, variant: "default" });
      } else {
        toast({ title: "Đã gửi bếp", description: `Đơn ${result.orderNumber ?? ""} đã gửi bếp thành công`, variant: "success" });
      }
      return result.kitchenOrderId ?? null;
    } catch (err) {
      hapticError();
      toast({ title: "Gửi bếp thất bại", description: (err as Error).message, variant: "error" });
      return null;
    }
  }, [pos, tenantId, branchId, userId, toast, settings, user, networkStatus.isOnline]);

  // ── Voucher / Coupon apply ──
  // Khi áp mã thành công, set orderDiscount = { mode: amount, value: discount }.
  // Nếu user xoá mã hoặc đổi tab, coupon reset.
  const handleApplyCoupon = useCallback(async (code: string) => {
    if (!pos.activeTabId || !pos.activeTab) return;
    const subtotal = pos.subtotal;
    if (subtotal <= 0) {
      toast({ title: "Đơn trống", description: "Thêm món trước khi áp mã.", variant: "warning" });
      return;
    }
    setCouponApplying(true);
    try {
      const result = await validateCoupon(code, subtotal, pos.activeTab.customerId);
      if (!result.valid || !result.discount_amount || result.discount_amount <= 0) {
        toast({
          title: "Mã không hợp lệ",
          description: result.error ?? "Kiểm tra lại mã hoặc điều kiện áp dụng.",
          variant: "error",
        });
        return;
      }
      pos.setOrderDiscount(pos.activeTabId, {
        mode: "amount",
        value: result.discount_amount,
      });
      setCouponApplied({ code, discount: result.discount_amount });
      toast({
        title: "Áp mã thành công",
        description: `Giảm ${formatCurrency(result.discount_amount)} ₫ cho đơn.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Áp mã thất bại",
        description: (err as Error).message,
        variant: "error",
      });
    } finally {
      setCouponApplying(false);
    }
  }, [pos, toast]);

  const handleRemoveCoupon = useCallback(() => {
    if (!pos.activeTabId) return;
    pos.setOrderDiscount(pos.activeTabId, undefined);
    setCouponApplied(null);
  }, [pos]);

  // Reset coupon khi đổi tab (mỗi tab có discount riêng).
  useEffect(() => {
    setCouponApplied(null);
  }, [pos.activeTabId]);

  // Migration 00070: persist platform info xuống DB sau khi đơn đã gửi bếp.
  // Local state thôi không đủ — RPC thanh toán đọc commission_percent từ
  // kitchen_orders → cần đồng bộ mỗi lần user đổi platform/fee/% sau gửi bếp.
  const persistDeliveryPlatform = useCallback(
    async (
      kitchenOrderId: string,
      platform: import("@/lib/types/fnb").DeliveryPlatform,
      fee: number,
      percent: number,
    ) => {
      if (!kitchenOrderId.startsWith("local_")) {
        // Bỏ qua đơn offline (chưa có DB row thật) — local state đủ;
        // khi sync sẽ replay sendToKitchen kèm platform info.
        try {
          await setDeliveryPlatformService(kitchenOrderId, platform, fee, percent);
        } catch (err) {
          console.error("persistDeliveryPlatform failed", err);
          toast({
            title: "Không lưu được thông tin sàn",
            description: "Hãy thử đổi lại hoặc kiểm tra mạng.",
            variant: "warning",
          });
        }
      }
    },
    [toast],
  );

  // ── Print pre-bill ──
  const handlePrintPreBill = useCallback(() => {
    const tab = pos.activeTab;
    if (!tab || tab.lines.length === 0) return;

    // Migration 00070: nếu là đơn sàn → bill in NET (quán thực thu),
    // commission line tách riêng cho shipper thấy.
    const commissionPercent = tab.platformCommissionPercent ?? 0;
    const isPlatformOrder =
      tab.orderType === "delivery" &&
      !!tab.deliveryPlatform &&
      tab.deliveryPlatform !== "direct" &&
      commissionPercent > 0;
    const commissionAmount = isPlatformOrder
      ? Math.round((pos.total * commissionPercent) / 100)
      : 0;
    const netTotal = pos.total - commissionAmount;

    printPreBill({
      orderNumber: tab.label,
      tableName: tab.label,
      orderType: tab.orderType,
      items: tab.lines.map((l) => ({
        name: l.productName,
        variant: l.variantLabel,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        toppings: l.toppings.map((t) => ({ name: t.name, quantity: t.quantity, price: t.price })),
        note: l.note,
      })),
      subtotal: pos.subtotal,
      discountAmount: pos.orderDiscountAmount,
      deliveryFee: 0,
      total: netTotal,
      createdAt: new Date().toISOString(),
      cashierName: user?.fullName,
      storeName: settings.print.showStoreName ? settings.store.name : undefined,
      storeAddress: settings.print.showStoreAddress ? settings.store.address : undefined,
      storePhone: settings.print.showStorePhone ? settings.store.phone : undefined,
      paperSize: settings.print.paperSize === "58mm" ? "58mm" : "80mm",
      footer: settings.print.receiptFooter,
      deliveryPlatform: tab.deliveryPlatform,
      platformCommissionPercent: isPlatformOrder ? commissionPercent : undefined,
      platformCommissionAmount: isPlatformOrder ? commissionAmount : undefined,
    });
  }, [pos, settings, user]);

  // ── Payment ──
  const handlePayment = useCallback(
    async (payload: FnbPaymentConfirmPayload) => {
      const tab = pos.activeTab;
      // CEO 29/05/2026: lấy kitchenOrderId TRỰC TIẾP từ giá trị handleSendToKitchen
      // trả về — KHÔNG đọc lại pos.activeTab (closure cũ chưa cập nhật state sau
      // await → trước đây koId undefined → bấm Thanh toán đơ im lặng, mất đơn).
      let koId = tab?.kitchenOrderId ?? null;
      if (!koId && tab && tab.lines.length > 0) {
        koId = await handleSendToKitchen();
      }

      if (!koId) {
        toast({
          title: "Chưa thể thanh toán",
          description: "Đơn chưa gửi được bếp hoặc chưa có món — vui lòng thử lại.",
          variant: "error",
        });
        return;
      }

      try {
        const tab = pos.activeTab;
        const payResult = await offlineFnbPayment({
          kitchenOrderId: koId,
          tenantId,
          branchId: branchId!,
          createdBy: userId,
          customerName: payload.customerName,
          paymentMethod: payload.paymentMethod,
          paymentBreakdown: payload.paymentBreakdown
            ? (Object.entries(payload.paymentBreakdown)
                .filter(([, amount]) => amount > 0)
                .map(([method, amount]) => ({ method: method as "cash" | "transfer" | "card", amount })))
            : undefined,
          paid: payload.paid,
          discountAmount: pos.orderDiscountAmount > 0 ? pos.orderDiscountAmount : undefined,
          shiftId: currentShift?.id ?? null,
          tipAmount: payload.tipAmount,
        }, networkStatus.isOnline);

        // Day 18/05/2026 (CEO): toast tiêu hao NVL theo BOM (FnB online)
        const bomResults = (payResult as { bomConsumeResults?: import("@/lib/services").BomConsumeResult[] }).bomConsumeResults;
        if (bomResults && bomResults.length > 0) {
          const lines: string[] = [];
          let hasWarning = false;
          for (const r of bomResults) {
            for (const m of r.result.consumed) {
              lines.push(
                `• ${m.material_code ?? m.material_name ?? "NVL"}: ${m.qty}${m.unit ? ` ${m.unit}` : ""}`,
              );
            }
            if (r.result.warnings && r.result.warnings.length > 0) hasWarning = true;
          }
          if (lines.length > 0) {
            const head = lines.slice(0, 8).join("\n");
            const tail = lines.length > 8 ? `\n…và ${lines.length - 8} NVL khác` : "";
            toast({
              variant: hasWarning ? "warning" : "success",
              title: hasWarning
                ? "Đã trừ NVL — có cảnh báo tồn kho âm"
                : "Đã trừ NVL theo BOM",
              description: head + tail,
              duration: hasWarning ? 12000 : 6000,
            });
          }
        }

        // Auto-print receipt if enabled.
        // Bọc print trong try/catch riêng: lỗi in KHÔNG được làm hỏng
        // flow thanh toán (payment đã success → không được hiển thị "Thanh toán thất bại").
        if (settings.print.autoPrintReceipt && tab) {
          try {
            const tipAmount = payload.tipAmount ?? 0;
            // Migration 00070: total trên bill = NET (quán thực thu) cho đơn sàn.
            const commissionPercent = tab.platformCommissionPercent ?? 0;
            const isPlatformOrderPrint =
              tab.orderType === "delivery" &&
              !!tab.deliveryPlatform &&
              tab.deliveryPlatform !== "direct" &&
              commissionPercent > 0;
            const grossWithTip = pos.total + tipAmount;
            const commissionAmount = isPlatformOrderPrint
              ? Math.round((pos.total * commissionPercent) / 100)
              : 0;
            const netWithTip = grossWithTip - commissionAmount;
            printFnbReceipt({
              invoiceCode: payResult.invoiceCode,
              orderNumber: tab.label,
              tableName: tab.label,
              orderType: tab.orderType,
              items: tab.lines.map((l) => ({
                name: l.productName,
                variant: l.variantLabel,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                toppings: l.toppings.map((t) => ({ name: t.name, quantity: t.quantity, price: t.price })),
                note: l.note,
              })),
              subtotal: pos.subtotal,
              discountAmount: pos.orderDiscountAmount,
              deliveryFee: 0,
              tipAmount,
              total: netWithTip,
              createdAt: new Date().toISOString(),
              cashierName: user?.fullName,
              paymentMethod: payload.paymentMethod,
              paid: payload.paid,
              change: isPlatformOrderPrint ? 0 : Math.max(0, payload.paid - grossWithTip),
              customerName: payload.customerName,
              storeName: settings.print.showStoreName ? settings.store.name : undefined,
              storeAddress: settings.print.showStoreAddress ? settings.store.address : undefined,
              storePhone: settings.print.showStorePhone ? settings.store.phone : undefined,
              paperSize: settings.print.paperSize === "58mm" ? "58mm" : "80mm",
              footer: settings.print.receiptFooter,
              receiptStyle: settings.print.receiptStyle,
              showBarcode: settings.print.showBarcode,
              showQr: settings.print.showQr,
              bankInfo: settings.print.showQr ? {
                bankName: settings.payment.bankName,
                bankAccount: settings.payment.bankAccount,
                bankHolder: settings.payment.bankHolder,
                bankBin: settings.payment.bankBin,
                vietQrEnabled: settings.payment.vietQrEnabled,
              } : undefined,
              deliveryPlatform: tab.deliveryPlatform,
              platformCommissionPercent: isPlatformOrderPrint ? commissionPercent : undefined,
              platformCommissionAmount: isPlatformOrderPrint ? commissionAmount : undefined,
            });
          } catch (printErr) {
            console.error("printFnbReceipt error:", printErr);
            toast({
              title: "Thanh toán OK nhưng in hoá đơn lỗi",
              description: "Anh/chị có thể in lại từ màn hình hoá đơn.",
              variant: "warning",
            });
          }
        }

        // Cập nhật trạng thái bàn ngay (optimistic) để floor plan không còn
        // hiển thị bàn đỏ khi đã thanh toán xong — kể cả chế độ offline.
        if (tab?.tableId) {
          setTables((prev) =>
            prev.map((t) =>
              t.id === tab.tableId
                ? { ...t, status: "cleaning" as const, currentOrderId: null }
                : t
            )
          );
        }

        // Day 3 16/05/2026: Audit log discount manual (sau OTP duyệt)
        // Best-effort: nếu fail thì không block checkout (đã success)
        if (
          networkStatus.isOnline &&
          tab?.discountAuditCtx &&
          pos.orderDiscountAmount > 0 &&
          payResult.invoiceId &&
          payResult.invoiceCode
        ) {
          const auditCtx = tab.discountAuditCtx;
          const subtotal = pos.subtotal;
          const percent =
            subtotal > 0 ? (pos.orderDiscountAmount / subtotal) * 100 : 0;
          recordDiscountAudit({
            invoiceId: payResult.invoiceId,
            invoiceCode: payResult.invoiceCode,
            invoiceTotal: pos.total,
            discountAmount: pos.orderDiscountAmount,
            discountPercent: Math.round(percent * 100) / 100,
            reason: auditCtx.reason,
            otpId: auditCtx.otpId,
          }).catch((err) => console.warn("[FnB] recordDiscountAudit:", err));
        }

        // KM-2: Tăng usage_count atomic — chỉ khi online
        // KM-4: Tag invoice với promotion_id để báo cáo hiệu quả KM
        if (networkStatus.isOnline && appliedPromotion?.promotion.id) {
          try {
            await incrementPromotionUsage(appliedPromotion.promotion.id);
          } catch (err) {
            console.warn("incrementPromotionUsage failed:", err);
          }
          if (payResult.invoiceId) {
            const freeValue =
              appliedPromotion.freeItems?.reduce(
                (s, f) => s + f.quantity * f.unitPrice,
                0,
              ) ?? 0;
            tagInvoicePromotion({
              invoiceId: payResult.invoiceId,
              promotionId: appliedPromotion.promotion.id,
              promotionDiscount: appliedPromotion.discountAmount,
              promotionFreeValue: freeValue,
            }).catch((err) => {
              // Tag fail → KM count báo cáo có thể thiếu 1 đơn, nhưng đơn
              // đã thanh toán xong. Không block UX. Log để admin biết.
              console.error("[FnB] tagInvoicePromotion failed:", err);
            });
          }
        }

        // L-2: Earn loyalty points cho KH có account — bg fire
        if (
          networkStatus.isOnline &&
          tab?.customerId &&
          payResult.invoiceId
        ) {
          const customerId = tab.customerId;
          const customerName = tab.customerName ?? "khách";
          const invId = payResult.invoiceId;
          const totalAmount = pos.total;
          getLoyaltySettings()
            .then((settings) => {
              if (!settings?.isEnabled) return;
              return earnLoyaltyPoints(customerId, invId, totalAmount).then(
                (newPoints) => {
                  const earned = Math.floor(
                    (totalAmount / (settings.amountPerPoint || 1)) *
                      (settings.pointsPerAmount || 0),
                  );
                  if (earned > 0) {
                    toast({
                      title: `Đã tích ${earned} điểm cho ${customerName}`,
                      description: `Tổng điểm: ${newPoints}`,
                      variant: "info",
                    });
                  }
                },
              );
            })
            .catch((err) => console.warn("earnLoyaltyPoints failed:", err));
        }

        setPaymentOpen(false);
        pos.closeTab(pos.activeTabId);
        setAppliedPromotion(null);
        setPromotionCleared(false);
        hapticSuccess();

        if (!networkStatus.isOnline) {
          toast({ title: "Đã lưu thanh toán ngoại tuyến", description: "Sẽ đồng bộ khi có mạng", variant: "default" });
        } else {
          toast({ title: "Thanh toán thành công", variant: "success" });
          // Refresh tables từ server để đồng bộ status chính xác
          if (branchId) getTablesByBranch(branchId).then(setTables).catch((err) => console.error("[FnB] refresh tables failed:", err));
        }
      } catch (err) {
        hapticError();
        toast({ title: "Thanh toán thất bại", description: (err as Error).message, variant: "error" });
      }
    },
    [pos, tenantId, branchId, userId, handleSendToKitchen, toast, settings, user, networkStatus.isOnline, currentShift?.id, appliedPromotion]
  );

  // ── Table select (from floor plan) ──
  const handleTableSelect = useCallback(
    (table: RestaurantTable) => {
      if (table.status === "available") {
        pos.createTab(`Bàn ${table.tableNumber}`, "dine_in", table.id);
        setShowFloorPlan(false);
      } else if (table.status === "occupied" && table.currentOrderId) {
        // Switch to existing tab for this table
        const existingTab = pos.tabs.find((t) => t.tableId === table.id);
        if (existingTab) {
          pos.switchTab(existingTab.id);
          setShowFloorPlan(false);
        } else {
          // POS-FIX-B3: bàn occupied nhưng không có tab local (vd reload, đổi
          // ca). Thay vì silent fail (click không gì xảy ra), tạo tab mới link
          // tới table + thông báo barista xem đơn cũ ở KDS.
          const newTabId = pos.createTab(
            `Bàn ${table.tableNumber}`,
            "dine_in",
            table.id,
          );
          // Gắn currentOrderId để cart có context — barista có thể thêm món
          // mới vào đơn cũ qua addItemsToExistingOrder.
          pos.updateTabMeta(newTabId, {
            kitchenOrderId: table.currentOrderId,
          });
          setShowFloorPlan(false);
          toast({
            title: `Bàn ${table.tableNumber} đang có đơn cũ`,
            description: "Tab mới được link tới đơn hiện tại. Xem món đã gọi ở Màn bếp (KDS).",
            variant: "default",
            duration: 5000,
          });
        }
      } else if (table.status === "cleaning") {
        markTableAvailable(table.id).then(() => {
          if (branchId) getTablesByBranch(branchId).then(setTables);
        });
      }
    },
    [pos, branchId, toast],
  );

  // ── Shift handlers ──
  const handleShiftClick = useCallback(() => {
    if (currentShift) {
      setCloseShiftDialogOpen(true);
    } else {
      setOpenShiftDialogOpen(true);
    }
  }, [currentShift]);

  const handleOpenShift = useCallback(
    async (startingCash: number) => {
      if (!branchId || !userId || !tenantId) return;
      const shift = await openShift({
        tenantId,
        branchId,
        cashierId: userId,
        startingCash,
      });
      setCurrentShift(shift);
      setOpenShiftDialogOpen(false);
    },
    [tenantId, branchId, userId]
  );

  const handleCloseShift = useCallback(
    async (actualCash: number, note?: string) => {
      if (!currentShift) return;
      const report = await closeShift({ shiftId: currentShift.id, actualCash, note });

      // In báo cáo Z tự động sau khi đóng ca thành công
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
        toast({
          title: "Đóng ca OK nhưng in báo cáo Z lỗi",
          description: "Anh/chị có thể in lại từ Lịch sử ca.",
          variant: "warning",
        });
      }

      setCurrentShift(null);
      setCloseShiftDialogOpen(false);

      toast({
        title: "Đã đóng ca",
        description: `Chênh lệch: ${
          (report.cashDifference ?? 0) === 0
            ? "KHỚP"
            : (report.cashDifference ?? 0) > 0
              ? `THỪA ${formatNumber(report.cashDifference ?? 0)}`
              : `THIẾU ${formatNumber(Math.abs(report.cashDifference ?? 0))}`
        }`,
        variant: (report.cashDifference ?? 0) === 0 ? "success" : "warning",
      });
    },
    [currentShift, settings, currentBranch, user, toast]
  );

  // ── Void kitchen order (trước khi thanh toán) ──
  //   RPC kiểm quyền + ghi POS exception event trong cùng transaction.
  //   Sau khi huỷ → close tab, refresh tables.
  // Helper chung — execute cancel với optional OTP. Tách ra để tái sử dụng
  // cho cả flow direct (có quyền) và flow OTP-delegated (Phase 3a).
  const executeKitchenOrderCancel = useCallback(
    async (args: {
      orderId: string;
      reasonCode: string;
      label: string;
      tableId?: string | null;
      otpId?: string;
    }) => {
      try {
        await cancelUnpaidKitchenOrder({
          orderId: args.orderId,
          reasonCode: args.reasonCode,
          shiftId: currentShift?.id ?? null,
          otpId: args.otpId,
        });
        hapticSuccess();
        toast({
          title: "Đã huỷ đơn bếp",
          description: args.otpId
            ? `Đơn ${args.label} đã được huỷ (duyệt qua OTP). Lý do: ${args.reasonCode}`
            : `Đơn ${args.label} đã được huỷ. Lý do: ${args.reasonCode}`,
          variant: "success",
        });
        setVoidReason("");
        setVoidReasonOther("");
        // Optimistic: release table trên UI ngay
        if (args.tableId) {
          setTables((prev) =>
            prev.map((t) =>
              t.id === args.tableId
                ? { ...t, status: "available" as const, currentOrderId: null }
                : t,
            ),
          );
        }
        // Đóng tab hiện tại nếu trùng order vừa huỷ
        if (pos.activeTab?.kitchenOrderId === args.orderId) {
          pos.closeTab(pos.activeTabId);
        }
        setVoidConfirmOpen(false);
        if (branchId)
          getTablesByBranch(branchId)
            .then(setTables)
            .catch((err) => console.error("[FnB] refresh tables failed:", err));
      } catch (err) {
        hapticError();
        toast({
          title: "Huỷ đơn bếp thất bại",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
      }
    },
    [pos, branchId, currentShift?.id, toast],
  );

  const handleVoidKitchenOrder = useCallback(async () => {
    const tab = pos.activeTab;
    if (!tab?.kitchenOrderId) return;
    if (!networkStatus.isOnline) {
      hapticError();
      toast({
        title: "Cần kết nối mạng",
        description: "Huỷ đơn bếp không khả dụng khi ngoại tuyến.",
        variant: "warning",
      });
      return;
    }
    if (!voidReason.trim()) {
      toast({
        title: "Vui lòng nhập lý do huỷ",
        description: "Lý do bắt buộc để theo dõi loss prevention.",
        variant: "warning",
      });
      return;
    }
    if (voidReason === "Khác" && !voidReasonOther.trim()) {
      toast({
        title: "Vui lòng ghi rõ lý do",
        description: 'Bạn đã chọn "Khác" — hãy nhập chi tiết để lưu vào audit log.',
        variant: "warning",
      });
      return;
    }
    const effectiveReason =
      voidReason === "Khác" ? `Khác: ${voidReasonOther.trim()}` : voidReason.trim();

    // Phase 3a: cashier không có quyền → chuyển sang OTP delegation flow.
    if (!canCancelUnpaidOrder) {
      setVoidOtpContext({
        orderId: tab.kitchenOrderId,
        label: tab.label,
        reasonCode: effectiveReason,
        tableId: tab.tableId ?? null,
      });
      setVoidConfirmOpen(false);
      setVoidOtpDialogOpen(true);
      return;
    }

    await executeKitchenOrderCancel({
      orderId: tab.kitchenOrderId,
      reasonCode: voidReason.trim(),
      label: tab.label,
      tableId: tab.tableId,
    });
  }, [
    pos,
    canCancelUnpaidOrder,
    networkStatus.isOnline,
    toast,
    voidReason,
    voidReasonOther,
    executeKitchenOrderCancel,
  ]);

  // ── Transfer table (chuyển bàn) ──
  const handleTransferTable = useCallback(
    async (toTableId: string) => {
      const tab = pos.activeTab;
      if (!tab?.kitchenOrderId || !tab.tableId) return;
      if (tab.tableId === toTableId) {
        toast({ title: "Bàn đích trùng bàn hiện tại", variant: "warning" });
        return;
      }
      if (!networkStatus.isOnline) {
        hapticError();
        toast({
          title: "Cần kết nối mạng",
          description: "Chuyển bàn không khả dụng khi ngoại tuyến.",
          variant: "warning",
        });
        return;
      }
      try {
        await transferTableService(tab.kitchenOrderId, tab.tableId, toTableId);
        const newTable = tables.find((t) => t.id === toTableId);
        hapticSuccess();
        toast({
          title: "Đã chuyển bàn",
          description: newTable ? `Đơn đã chuyển sang Bàn ${newTable.tableNumber}` : "Đơn đã được chuyển",
          variant: "success",
        });
        setTransferTableOpen(false);
        if (branchId) getTablesByBranch(branchId).then(setTables).catch((err) => console.error("[FnB] refresh tables failed:", err));
      } catch (err) {
        hapticError();
        toast({
          title: "Chuyển bàn thất bại",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
      }
    },
    [pos, tables, branchId, networkStatus.isOnline, toast]
  );

  // ── Customer selection ──
  const handleCustomerSelect = useCallback(
    (customer: Customer | null) => {
      pos.updateTabMeta(pos.activeTabId, {
        customerId: customer?.id,
        customerName: customer?.name ?? "Khách lẻ",
      });
      setCustomerPickerOpen(false);
    },
    [pos]
  );

  // CEO 13/05: BẤT KỲ giảm giá MANUAL nào → OTP duyệt từ manager.
  // Xoá discount (undefined hoặc value=0) → skip OTP, apply trực tiếp.
  // Promotion/coupon đi route khác (handleApplyCoupon) nên không qua handler này.
  const handleManualDiscount = useCallback(
    (d: import("@/lib/types/fnb").FnbDiscountInput | undefined) => {
      if (!pos.activeTabId) return;
      const isClear = !d || d.value === 0;
      if (isClear) {
        pos.setOrderDiscount(pos.activeTabId, d);
        return;
      }
      // Manual > 0 → queue + mở OTP dialog
      const activeTabId = pos.activeTabId;
      pendingDiscountRef.current = () => pos.setOrderDiscount(activeTabId, d);
      setDiscountOtpOpen(true);
    },
    [pos]
  );

  // ── Open split bill dialog ──
  const handleOpenSplitBill = useCallback(async () => {
    const tab = pos.activeTab;
    if (!tab?.kitchenOrderId) return;
    try {
      const order = await getKitchenOrderById(tab.kitchenOrderId);
      if (!order?.items || order.items.length < 2) return;
      setSplitItems(
        order.items.map((item) => ({
          id: item.id,
          name: item.productName + (item.variantLabel ? ` (${item.variantLabel})` : ""),
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        }))
      );
      setSplitBillOpen(true);
    } catch (err) {
      console.error("openSplitBill error:", err);
      toast({
        title: "Không tải được chi tiết đơn",
        description: "Không thể tách bill. Vui lòng thử lại.",
        variant: "error",
      });
    }
  }, [pos, toast]);

  const handleSplitByItems = useCallback(
    async (itemIds: string[]) => {
      const tab = pos.activeTab;
      if (!tab?.kitchenOrderId) return;
      if (!networkStatus.isOnline) {
        hapticError();
        toast({
          title: "Cần kết nối mạng",
          description: "Tách bill không khả dụng khi ngoại tuyến. Vui lòng chờ khôi phục kết nối.",
          variant: "warning",
        });
        return;
      }
      if (!itemIds || itemIds.length === 0) {
        toast({ title: "Chọn ít nhất 1 món để tách", variant: "warning" });
        return;
      }
      try {
        await splitByItems(tab.kitchenOrderId, itemIds);
        // Create a new tab for the child order
        pos.createTab(`${tab.label}-B`, tab.orderType, tab.tableId);
        hapticSuccess();
        toast({
          title: "Đã tách bill",
          description: `${itemIds.length} món chuyển sang đơn ${tab.label}-B`,
          variant: "success",
        });
      } catch (err) {
        hapticError();
        toast({
          title: "Tách bill thất bại",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
      }
    },
    [pos, networkStatus.isOnline, toast]
  );

  const handleSplitEqually = useCallback(
    async (numberOfWays: number) => {
      const tab = pos.activeTab;
      if (!tab?.kitchenOrderId) return;
      if (!networkStatus.isOnline) {
        hapticError();
        toast({
          title: "Cần kết nối mạng",
          description: "Tách bill không khả dụng khi ngoại tuyến. Vui lòng chờ khôi phục kết nối.",
          variant: "warning",
        });
        return;
      }
      if (numberOfWays < 2 || numberOfWays > 10) {
        toast({
          title: "Số lần tách không hợp lệ",
          description: "Chỉ chấp nhận từ 2 đến 10 bill.",
          variant: "warning",
        });
        return;
      }
      try {
        await splitEqually(tab.kitchenOrderId, numberOfWays);
        // Create tabs for child orders
        for (let i = 1; i < numberOfWays; i++) {
          const suffix = String.fromCharCode(65 + i);
          pos.createTab(`${tab.label}-${suffix}`, tab.orderType, tab.tableId);
        }
        hapticSuccess();
        toast({
          title: "Đã tách bill",
          description: `Đơn đã chia thành ${numberOfWays} phần bằng nhau`,
          variant: "success",
        });
      } catch (err) {
        hapticError();
        toast({
          title: "Tách bill thất bại",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
      }
    },
    [pos, networkStatus.isOnline, toast]
  );

  // ── Keyboard shortcuts (F3/F4/F9/F10/Ctrl+Tab) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA";

      // Tab management
      if (e.key === "Tab" && e.ctrlKey) {
        e.preventDefault();
        const curIdx = pos.tabs.findIndex((t) => t.id === pos.activeTabId);
        if (e.shiftKey) {
          const prevIdx = (curIdx - 1 + pos.tabs.length) % pos.tabs.length;
          pos.switchTab(pos.tabs[prevIdx].id);
        } else {
          const nextIdx = (curIdx + 1) % pos.tabs.length;
          pos.switchTab(pos.tabs[nextIdx].id);
        }
        return;
      }
      if (e.key === "t" && e.ctrlKey) {
        e.preventDefault();
        pos.createTab("Mang về", "takeaway");
        return;
      }
      if (e.key === "w" && e.ctrlKey && pos.tabs.length > 1) {
        e.preventDefault();
        pos.closeTab(pos.activeTabId);
        return;
      }

      // F-key shortcuts (always fire, even in inputs)
      if (e.key === "F3") {
        e.preventDefault();
        setSearchModalOpen(true);
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        setCustomerPickerOpen(true);
        return;
      }
      // POS-FIX-B5: F9/F10 luôn fire kể cả khi cursor ở input (note/coupon/
      // search). Trước đây check `data-allow-hotkeys` nhưng KHÔNG component
      // nào set → barista gõ note "ít đá" rồi F10 bị chặn, phải blur trước.
      // FnB không có input nhập tiền-dưa risky như Retail nên cho phép luôn.
      if (e.key === "F9") {
        e.preventDefault();
        if (pos.lineCount > 0) setPaymentOpen(true);
        return;
      }
      if (e.key === "F10") {
        e.preventDefault();
        if (pos.lineCount > 0) handleSendToKitchen();
        return;
      }
      if (e.key === "F1" || (e.key === "?" && !inInput)) {
        e.preventDefault();
        setKeyboardHelpOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (keyboardHelpOpen) setKeyboardHelpOpen(false);
        else if (searchModalOpen) setSearchModalOpen(false);
        else if (customerPickerOpen) setCustomerPickerOpen(false);
        else if (paymentOpen) setPaymentOpen(false);
        else if (splitBillOpen) setSplitBillOpen(false);
        else if (mobileCartOpen) setMobileCartOpen(false);
        else if (showFloorPlan) setShowFloorPlan(false);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    pos, searchModalOpen, customerPickerOpen, paymentOpen,
    splitBillOpen, showFloorPlan, mobileCartOpen, keyboardHelpOpen,
    handleSendToKitchen,
  ]);

  // Sprint LOAD-1 (CEO 08/05): Phân biệt 3 state để loading UX đẹp hơn.
  // 1) auth đang load → skeleton (user thấy đang load, không tưởng lỗi)
  // 2) auth done + KHÔNG có branch FnB nào → empty state đẹp với CTA
  // 3) data đang load (branchId có, products/tables fetching) → skeleton
  if (authLoading) {
    return (
      <FnbLoadingSkeleton
        title="Đang kiểm tra phiên đăng nhập"
        detail="OneBiz đang xác nhận tài khoản, doanh nghiệp và chi nhánh trước khi mở POS FnB."
        elapsedMs={blockingLoadMs}
        onRetry={retryFnbLoad}
      />
    );
  }
  // CEO 13/05: Nếu tenant không có store nào (chỉ có kho/xưởng) → empty.
  // POS FnB chỉ phục vụ Quán FnB. Phải có ít nhất 1 chi nhánh type=store.
  const hasAnyStoreBranch = branches.some((b) => b.branchType === "store");
  if (!hasAnyStoreBranch) {
    return (
      <FnbEmptyBranch
        onMenuClick={() => setSidenavOpen(true)}
        onSearch={() => setSearchModalOpen(true)}
      />
    );
  }

  if (!branchId) {
    // Phân biệt: chưa có branch nào (tenant rỗng) vs có branch nhưng chưa pick
    if (branches.length === 0) {
      return <FnbEmptyBranch onMenuClick={() => setSidenavOpen(true)} onSearch={() => setSearchModalOpen(true)} />;
    }
    // Có branch nhưng currentBranch null — render header với chip để user chọn
    return (
      <div className="flex flex-col h-screen bg-surface-container-low">
        <FnbHeader
          tabs={[]}
          activeTabId=""
          switchTab={() => {}}
          closeTab={() => {}}
          createTab={() => {}}
          onToggleFloorPlan={() => {}}
          onSearch={() => setSearchModalOpen(true)}
          onMenuClick={() => setSidenavOpen(true)}
        />
        <FnbSidenavDrawer
          open={sidenavOpen}
          onClose={() => setSidenavOpen(false)}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
          <div className="relative w-24 h-24">
            <div className="absolute inset-0 rounded-full bg-primary-fixed/30 animate-pulse" />
            <div className="relative w-full h-full flex items-center justify-center text-primary">
              <Icon name="storefront" size={48} />
            </div>
          </div>
          <div className="text-center space-y-1">
            <h2 className="font-heading text-xl font-bold text-foreground">
              Chọn chi nhánh để bắt đầu
            </h2>
            <p className="text-sm text-on-surface-variant">
              Bấm chip <strong className="text-foreground">&quot;Chọn chi nhánh&quot;</strong> trên header để chọn quán đang làm việc.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    // Data còn fetch (products, tables) — skeleton match layout thật
    return (
      <FnbLoadingSkeleton
        title={networkStatus.isOnline ? "Đang tải menu, bàn và ca bán" : "Đang mở dữ liệu F&B đã lưu"}
        detail={
          networkStatus.isOnline
            ? "Đang đồng bộ menu, khu vực bàn và ca bán của chi nhánh hiện tại."
            : "Thiết bị đang offline, OneBiz sẽ ưu tiên dữ liệu đã cache trên máy."
        }
        elapsedMs={blockingLoadMs}
        onRetry={retryFnbLoad}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-surface-container-low">
      <ConnectionStatusBar
        status={networkStatus}
        onClick={() => setSyncDrawerOpen(true)}
      />
      <FnbHeader
        tabs={pos.tabs}
        activeTabId={pos.activeTabId}
        switchTab={pos.switchTab}
        closeTab={pos.closeTab}
        createTab={() => pos.createTab("Mang về", "takeaway")}
        onToggleFloorPlan={() => setShowFloorPlan(!showFloorPlan)}
        onSearch={() => setSearchModalOpen(true)}
        shift={currentShift}
        onShiftClick={handleShiftClick}
        viewMode={showFloorPlan ? "floorplan" : "menu"}
        onMenuClick={() => setSidenavOpen(true)}
        deliveryCountToday={deliveryCountToday}
      />

      {/* Sprint A: Sidenav drawer (☰ → slide-in). */}
      <FnbSidenavDrawer
        open={sidenavOpen}
        onClose={() => setSidenavOpen(false)}
        onCloseShift={
          currentShift ? () => setCloseShiftDialogOpen(true) : undefined
        }
        hasOpenShift={!!currentShift}
        onSwitchUser={() => setPinSwitchOpen(true)}
      />

      {/* Sprint B.5 (CEO 12/05): PIN POS switch user (Approach Z) */}
      {branchId && (
        <PosPinSwitchDialog
          open={pinSwitchOpen}
          onOpenChange={setPinSwitchOpen}
          branchId={branchId}
          currentUserId={userId ?? undefined}
          onSwitched={() => {
            // Reload POS với user mới — session đã swap, AuthContext sẽ
            // pick up profile mới khi mount.
            window.location.reload();
          }}
        />
      )}

      {/* Sprint POS-FNB-1 (CEO 06/05): consolidate 2 banner → 1 strip duy nhất.
          Trước: tier banner (40px) + promotion banner (40px) = 80px khi đồng
          thời hiển thị → ăn space menu, dồn nén.
          Sau: 1 strip 32px chia 2 segment, dùng divider giữa 2 thông tin. */}
      {(appliedTier || (appliedPromotion && appliedPromotion.discountAmount > 0)) && (
        <div className="bg-surface-container border-b border-outline-variant/20 px-3 py-1.5 flex items-center gap-3 text-xs flex-wrap">
          {appliedTier && (
            <span className="flex items-center gap-1.5 text-on-surface">
              <Icon name="sell" size={13} className="text-status-success" />
              <span>
                Bảng giá:{" "}
                <strong className="font-medium">{appliedTier.tierName}</strong>
                {appliedTier.tierCode && (
                  <span className="text-muted-foreground ml-1">
                    ({appliedTier.tierCode})
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">
                · {appliedTier.priceMap.size}/{products.length} sản phẩm có giá riêng
              </span>
            </span>
          )}
          {appliedTier && appliedPromotion && appliedPromotion.discountAmount > 0 && (
            <span className="h-3 w-px bg-outline-variant/40" aria-hidden />
          )}
          {appliedPromotion && appliedPromotion.discountAmount > 0 && (
            <span className="flex items-center gap-1.5 text-on-surface">
              <Icon name="percent" size={13} className="text-status-warning" />
              <span>
                Khuyến mãi:{" "}
                <strong className="font-medium">{appliedPromotion.promotion.name}</strong>
                <span className="text-muted-foreground ml-1">
                  ({appliedPromotion.reasonLabel})
                </span>
              </span>
              <span className="text-status-warning font-medium">
                −{formatCurrency(appliedPromotion.discountAmount)}đ
              </span>
              <button
                type="button"
                onClick={clearAppliedPromotion}
                className="ml-1 hover:bg-status-warning/20 rounded p-0.5 transition-colors"
                title="Bỏ áp dụng khuyến mãi"
              >
                <Icon name="close" size={13} />
              </button>
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sprint A: Categories sidebar cột trái (chỉ hiện khi không floor plan).
            FIX (CEO 07/05): KHÔNG guard length > 0 — luôn render trên md+ kể
            cả khi tenant chưa có SP để CEO thấy layout shell. Component đã
            có empty state "Chưa có danh mục".
            Ẩn trên mobile (<768px) để tận hết width — mobile dùng grid 4-col.
            md+ (≥768) hiện compact 144px, lg+ (≥1024) hiện 200px. */}
        {!showFloorPlan && (
          <>
            <div className="hidden lg:block">
              <FnbCategorySidebar
                categories={categoriesWithCount}
                totalCount={productsWithTier.length}
                activeCategoryId={activeCategoryId}
                onSelect={setActiveCategoryId}
              />
            </div>
            <div className="hidden md:block lg:hidden">
              <FnbCategorySidebar
                categories={categoriesWithCount}
                totalCount={productsWithTier.length}
                activeCategoryId={activeCategoryId}
                onSelect={setActiveCategoryId}
                compact
              />
            </div>
          </>
        )}

        {/* Left panel: menu grid OR floor plan */}
        <div className="flex-1 flex flex-col min-w-0 pb-24 lg:pb-0">
          {showFloorPlan ? (
            <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Icon name="progress_activity" size={24} className="animate-spin text-muted-foreground" /></div>}>
              <TableFloorPlan
                tables={tables}
                onSelectTable={handleTableSelect}
                orderTimestamps={orderTimestamps}
              />
            </Suspense>
          ) : (
            <>
              {/* Sprint B (CEO 06/05): Mobile (<768px) dùng GRID 4-col,
                   không kéo ngang. Phục vụ điện thoại bấm 1 chạm chọn danh mục.
                   Tablet/Desktop dùng sidebar bên trái (đã setup ở Sprint A). */}
              <div className="md:hidden">
                <FnbCategoryGrid
                  categories={categoriesWithCount}
                  totalCount={productsWithTier.length}
                  activeCategoryId={activeCategoryId}
                  onSelect={setActiveCategoryId}
                />
              </div>
              {/* Sprint UI-4: Sub-category pills row — chỉ hiện khi user
                   chọn 1 category cha + có ≥1 brand trong category đó.
                   Tự ẩn ở "Tất cả" hoặc category không gán brand. */}
              <FnbSubcategoryPills
                activeCategoryName={activeCategoryName}
                productsInCategory={productsInCategory}
                brandByProductId={brandByProductId}
                activeSubFilter={activeSubFilter}
                onSelectSubFilter={setActiveSubFilter}
              />
              {/* flex-1 min-h-0 cần thiết để cho FnbProductGrid (virtualized,
                   có scroll riêng) tự quản scroll thay vì wrapper — tránh
                   double scroll container. */}
              <div className="flex-1 min-h-0">
                <FnbProductGrid
                  products={filteredProducts}
                  onSelectProduct={handleSelectProduct}
                  cartQtyByProductId={cartQtyByProductId}
                />
              </div>
            </>
          )}
        </div>

        {/* Right panel: cart */}
        <FnbCart
          activeTab={pos.activeTab}
          subtotal={pos.subtotal}
          total={pos.total}
          orderDiscountAmount={pos.orderDiscountAmount}
          lineCount={pos.lineCount}
          updateLineQty={pos.updateLineQty}
          removeLine={pos.removeLine}
          onEditLine={handleEditLine}
          onSendToKitchen={handleSendToKitchen}
          onPayment={() => setPaymentOpen(true)}
          onSplitBill={handleOpenSplitBill}
          onChangeOrderType={pos.setActiveTabOrderType}
          onCustomerClick={() => setCustomerPickerOpen(true)}
          onDiscountChange={handleManualDiscount}
          onPrintPreBill={handlePrintPreBill}
          onVoidKitchenOrder={() => setVoidConfirmOpen(true)}
          onTransferTable={() => setTransferTableOpen(true)}
          onOrderHistory={() => setOrderHistoryOpen(true)}
          onApplyCoupon={handleApplyCoupon}
          onRemoveCoupon={handleRemoveCoupon}
          appliedCouponCode={couponApplied?.code}
          couponApplying={couponApplying}
          freeItems={appliedPromotion?.freeItems}
          onOrderNoteChange={(note) => pos.setOrderNote(pos.activeTabId, note)}
          onDeliveryPlatformChange={(platform, _commission) => {
            // Auto-fill commission% từ settings khi user pick platform.
            // User vẫn override được sau qua input riêng.
            const defaultCommission =
              platformSettings?.[platform]?.commissionPercent ?? 0;
            pos.setDeliveryPlatform(pos.activeTabId, platform, defaultCommission);
            // Migration 00070: persist nếu đơn đã gửi bếp.
            const koId = pos.activeTab?.kitchenOrderId;
            if (koId) {
              void persistDeliveryPlatform(
                koId,
                platform,
                pos.activeTab?.deliveryFee ?? 0,
                defaultCommission,
              );
            }
          }}
          onDeliveryFeeChange={(fee) => {
            pos.setDeliveryFee(pos.activeTabId, fee);
            const koId = pos.activeTab?.kitchenOrderId;
            const platform = pos.activeTab?.deliveryPlatform;
            if (koId && platform && platform !== "direct") {
              void persistDeliveryPlatform(
                koId,
                platform,
                fee,
                pos.activeTab?.platformCommissionPercent ?? 0,
              );
            }
          }}
          onPlatformCommissionChange={(pct) => {
            pos.setPlatformCommissionPercent(pos.activeTabId, pct);
            const koId = pos.activeTab?.kitchenOrderId;
            const platform = pos.activeTab?.deliveryPlatform;
            if (koId && platform && platform !== "direct") {
              void persistDeliveryPlatform(
                koId,
                platform,
                pos.activeTab?.deliveryFee ?? 0,
                pct,
              );
            }
          }}
          onDeliveryStaffChange={(staffId) =>
            pos.setDeliveryStaff(pos.activeTabId, staffId)
          }
          onDeliveryTierChange={(tier, fee) =>
            pos.setDeliveryTier(pos.activeTabId, tier, fee)
          }
          staffOptions={shipperOptions}
          selfDeliveryTiers={deliveryTiers}
          discountPresets={discountPresets}
        />
      </div>

      {/* Item dialog — lazy loaded */}
      {itemDialogOpen && (
        <Suspense fallback={null}>
          <FnbItemDialog
            open={itemDialogOpen}
            onOpenChange={(o) => {
              setItemDialogOpen(o);
              // Phase 1A.2: đóng dialog → clear edit-mode để add tiếp đúng nhánh.
              if (!o) {
                setEditingLineId(null);
                setItemModifierData(undefined);
              }
            }}
            product={selectedProduct}
            variants={itemVariants.length > 0 ? itemVariants : undefined}
            variantsLoading={itemVariantsLoading}
            toppings={toppingProducts.length > 0 ? toppingProducts : undefined}
            onConfirm={handleItemConfirm}
            initialSelection={dialogInitialSelection}
            confirmLabel={editingLineId ? "Cập nhật" : undefined}
            // CEO 01/06/2026 — Sprint 2.2e: dynamic modifier groups + options
            dynamicModifiers={itemModifierData}
          />
        </Suspense>
      )}

      {/* Payment dialog — lazy loaded */}
      {paymentOpen && (
        <Suspense fallback={null}>
          <FnbPaymentDialog
            open={paymentOpen}
            onOpenChange={setPaymentOpen}
            subtotal={pos.subtotal}
            discountAmount={pos.orderDiscountAmount}
            total={pos.total}
            lineCount={pos.lineCount}
            orderNumber={pos.activeTab?.kitchenOrderId ? pos.activeTab.label : undefined}
            onConfirm={handlePayment}
          />
        </Suspense>
      )}

      {/* Split bill dialog — lazy loaded */}
      {splitBillOpen && (
        <Suspense fallback={null}>
          <SplitBillDialog
            open={splitBillOpen}
            onOpenChange={setSplitBillOpen}
            items={splitItems}
            onSplitByItems={handleSplitByItems}
            onSplitEqually={handleSplitEqually}
          />
        </Suspense>
      )}

      {/* Shift dialogs — lazy loaded */}
      {openShiftDialogOpen && (
        <Suspense fallback={null}>
          <OpenShiftDialog
            open={openShiftDialogOpen}
            onOpenChange={setOpenShiftDialogOpen}
            onConfirm={handleOpenShift}
          />
        </Suspense>
      )}
      {closeShiftDialogOpen && (
        <Suspense fallback={null}>
          <CloseShiftDialog
            open={closeShiftDialogOpen}
            onOpenChange={setCloseShiftDialogOpen}
            currentShift={currentShift}
            onConfirm={handleCloseShift}
          />
        </Suspense>
      )}

      {/* CEO 05/06/2026: cảnh báo ca pending (auto-mark khi quá cutoff) */}
      <Suspense fallback={null}>
        <PendingShiftAlertSection branchId={currentBranch?.id ?? null} />
      </Suspense>


      {/* Search modal (F3) — lazy loaded */}
      {searchModalOpen && (
        <Suspense fallback={null}>
          <FnbSearchModal
            open={searchModalOpen}
            products={productsWithTier}
            onSelect={(product) => {
              handleSelectProduct(product);
              setSearchModalOpen(false);
            }}
            onClose={() => setSearchModalOpen(false)}
          />
        </Suspense>
      )}

      {/* Customer picker (F4) — lazy loaded */}
      {customerPickerOpen && (
        <Suspense fallback={null}>
          <FnbCustomerPicker
            open={customerPickerOpen}
            onSelect={handleCustomerSelect}
            onClose={() => setCustomerPickerOpen(false)}
          />
        </Suspense>
      )}

      {/* Sprint B (CEO 06/05): cart overlay hiện <lg (1024) — bao gồm mobile
          + tablet portrait. Tablet landscape (≥lg) giữ cart fixed bên phải.
          Lý do: tablet portrait 768px nếu fix cart 320 → menu zone chỉ còn
          304px (~2 cols). Drawer cho phép menu tận 624px (4 cols). */}
      {mobileCartOpen && (
        <div className="fixed inset-0 z-40 lg:hidden bg-black/35 backdrop-blur-sm flex justify-end">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Đóng giỏ hàng"
            onClick={() => setMobileCartOpen(false)}
          />
          <div className="relative z-10 flex h-full w-full flex-col bg-background shadow-2xl md:max-w-[460px]">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-surface-container-low">
            <div className="min-w-0">
              <span className="block text-sm font-semibold">Giỏ hàng</span>
              <span className="block truncate text-xs text-muted-foreground">
                {pos.activeTab?.label ?? "Đơn hiện tại"} · {pos.lineCount} món
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileCartOpen(false)}
              className="h-9 w-9 rounded-xl flex items-center justify-center hover:bg-muted"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="flex-1 flex flex-col min-h-0">
            <FnbCart
              activeTab={pos.activeTab}
              subtotal={pos.subtotal}
              total={pos.total}
              orderDiscountAmount={pos.orderDiscountAmount}
              lineCount={pos.lineCount}
              updateLineQty={pos.updateLineQty}
              removeLine={pos.removeLine}
              onEditLine={handleEditLine}
              onSendToKitchen={() => { handleSendToKitchen(); setMobileCartOpen(false); }}
              onPayment={() => { setPaymentOpen(true); setMobileCartOpen(false); }}
              onSplitBill={handleOpenSplitBill}
              onChangeOrderType={pos.setActiveTabOrderType}
              onCustomerClick={() => setCustomerPickerOpen(true)}
              onDiscountChange={handleManualDiscount}
              onPrintPreBill={handlePrintPreBill}
              onVoidKitchenOrder={() => setVoidConfirmOpen(true)}
              onTransferTable={() => setTransferTableOpen(true)}
              onOrderHistory={() => setOrderHistoryOpen(true)}
              onApplyCoupon={handleApplyCoupon}
              onRemoveCoupon={handleRemoveCoupon}
              appliedCouponCode={couponApplied?.code}
              couponApplying={couponApplying}
              freeItems={appliedPromotion?.freeItems}
              onOrderNoteChange={(note) => pos.setOrderNote(pos.activeTabId, note)}
              onDeliveryPlatformChange={(platform, _commission) => {
                const defaultCommission =
                  platformSettings?.[platform]?.commissionPercent ?? 0;
                pos.setDeliveryPlatform(pos.activeTabId, platform, defaultCommission);
              }}
              onDeliveryFeeChange={(fee) => pos.setDeliveryFee(pos.activeTabId, fee)}
              onPlatformCommissionChange={(pct) =>
                pos.setPlatformCommissionPercent(pos.activeTabId, pct)
              }
              onDeliveryStaffChange={(staffId) =>
                pos.setDeliveryStaff(pos.activeTabId, staffId)
              }
              onDeliveryTierChange={(tier, fee) =>
                pos.setDeliveryTier(pos.activeTabId, tier, fee)
              }
              staffOptions={shipperOptions}
              selfDeliveryTiers={deliveryTiers}
              discountPresets={discountPresets}
              mobile
            />
          </div>
          </div>
        </div>
      )}

      {/* Mobile cart FAB — POS-FIX-C4 + Sprint POS-FNB-1 (CEO 06/05):
          Trước: chỉ hiện label tab + count badge.
          Sau: hiện thêm TỔNG TIỀN để cashier không cần mở overlay
          mới biết bill bao nhiêu. Layout 2 dòng compact:
            [icon+count] [label tab]
                        [tổng tiền]                              */}
      {!mobileCartOpen && pos.lineCount > 0 && (
        <button
          type="button"
          onClick={() => setMobileCartOpen(true)}
          className="fixed inset-x-3 bottom-3 z-30 lg:hidden flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-surface-container-lowest/95 px-3 py-2.5 text-left ambient-shadow-floating backdrop-blur-md transition-colors hover:bg-surface-container-lowest"
          aria-label={`Mở giỏ hàng tab ${pos.activeTab?.label}, ${pos.lineCount} món, tổng ${formatCurrency(pos.subtotal ?? 0)}đ`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
              <Icon name="shopping_cart" size={20} />
              <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-status-error text-[10px] font-bold flex items-center justify-center">
                {pos.lineCount}
              </span>
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-xs font-semibold text-foreground">
                {pos.activeTab?.label ?? "Giỏ hàng"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                Chạm để kiểm tra đơn
              </span>
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-base font-black text-primary tabular-nums leading-none">
              {formatCurrency(pos.subtotal ?? 0)}đ
            </span>
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary-fixed px-2 py-0.5 text-[10px] font-semibold text-primary">
              Mở giỏ
            </span>
          </span>
        </button>
      )}

      {/* Sync queue drawer (mở từ ConnectionStatusBar) */}
      {syncDrawerOpen && (
        <Suspense fallback={null}>
          <SyncQueueDrawer
            open={syncDrawerOpen}
            onOpenChange={setSyncDrawerOpen}
            status={networkStatus}
          />
        </Suspense>
      )}

      {/* Order history (reprint) */}
      {orderHistoryOpen && branchId && (
        <Suspense fallback={null}>
          <FnbOrderHistoryDialog
            open={orderHistoryOpen}
            onOpenChange={setOrderHistoryOpen}
            branchId={branchId}
            tenantId={tenantId}
            userId={userId}
            shiftId={currentShift?.id ?? null}
            canVoidPaidBill={canVoidPaidBill}
            cashierName={user?.fullName}
            paperSize={settings.print.paperSize === "58mm" ? "58mm" : "80mm"}
            storeName={settings.print.showStoreName ? settings.store.name : undefined}
            storeAddress={settings.print.showStoreAddress ? settings.store.address : undefined}
            storePhone={settings.print.showStorePhone ? settings.store.phone : undefined}
            receiptFooter={settings.print.receiptFooter}
            receiptStyle={settings.print.receiptStyle}
          />
        </Suspense>
      )}

      {/* Void confirm dialog */}
      <Dialog open={voidConfirmOpen} onOpenChange={setVoidConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-status-error">
              <Icon name="cancel" size={16} /> Huỷ đơn bếp?
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-foreground">
              Đơn <b>{pos.activeTab?.label}</b> sẽ bị huỷ và bàn sẽ được giải phóng.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">
                Lý do huỷ <span className="text-status-error">*</span>
              </label>
              <select
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background"
              >
                <option value="">— Chọn lý do —</option>
                <option value="Khách đổi ý">Khách đổi ý</option>
                <option value="Hết nguyên liệu">Hết nguyên liệu</option>
                <option value="Pha sai món">Pha sai món</option>
                <option value="Khách bỏ đi">Khách bỏ đi (no-show)</option>
                <option value="Lỗi đặt món">Lỗi đặt món (nhân viên)</option>
                <option value="Khác">Khác</option>
              </select>
              {voidReason === "Khác" && (
                <input
                  type="text"
                  value={voidReasonOther}
                  onChange={(e) => setVoidReasonOther(e.target.value)}
                  autoFocus
                  maxLength={120}
                  placeholder="Nhập chi tiết lý do huỷ…"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background"
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Tip: Chỉ huỷ được đơn chưa thanh toán. Nếu đã in ticket, hãy thông báo
              cho bếp trước. Lý do sẽ ghi vào audit log.
            </p>
            {!canCancelUnpaidOrder && (
              <div className="rounded-md bg-status-warning/10 border border-status-warning/30 p-2.5 text-xs text-foreground">
                <Icon name="pin" size={14} className="inline-block mr-1 text-status-warning" />
                Bạn không có quyền huỷ. Sau khi xác nhận sẽ mở dialog xin OTP từ quản lý.
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setVoidConfirmOpen(false);
                setVoidReason("");
                setVoidReasonOther("");
              }}
              className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-muted"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handleVoidKitchenOrder}
              disabled={!voidReason.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-status-error text-white hover:bg-status-error/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {canCancelUnpaidOrder ? "Huỷ đơn" : "Xin OTP duyệt"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Phase 3a (CEO 12/05): OTP delegation dialog cho cashier không có quyền */}
      <OtpApprovalDialog
        open={voidOtpDialogOpen}
        onOpenChange={(o) => {
          setVoidOtpDialogOpen(o);
          if (!o) setVoidOtpContext(null);
        }}
        actionCode={OTP_ACTION_CODES.FNB_CANCEL_UNPAID_BILL}
        targetMeta={
          voidOtpContext
            ? {
                kitchen_order_id: voidOtpContext.orderId,
                reason_code: voidOtpContext.reasonCode,
                table_id: voidOtpContext.tableId,
              }
            : undefined
        }
        contextLabel={
          voidOtpContext
            ? `Huỷ đơn ${voidOtpContext.label} — lý do: ${voidOtpContext.reasonCode}`
            : undefined
        }
        onApproved={async (verified) => {
          if (!voidOtpContext) return;
          await executeKitchenOrderCancel({
            orderId: voidOtpContext.orderId,
            reasonCode: voidOtpContext.reasonCode,
            label: voidOtpContext.label,
            tableId: voidOtpContext.tableId,
            otpId: verified.otpId,
          });
          setVoidOtpContext(null);
        }}
      />

      {/* CEO 13/05: OTP duyệt MỌI giảm giá manual (FnB) — không còn check ngưỡng */}
      {/* Day 3 16/05/2026: lưu otpId + reason vào ref để ghi audit khi checkout */}
      <OtpApprovalDialog
        open={discountOtpOpen}
        onOpenChange={(o) => {
          setDiscountOtpOpen(o);
          if (!o) pendingDiscountRef.current = null;
        }}
        actionCode={OTP_ACTION_CODES.FNB_DISCOUNT_OVERRIDE}
        requireReason
        contextLabel={`Cashier yêu cầu giảm giá thủ công cho đơn ${pos.activeTab?.label ?? ""}`}
        onApproved={(verified, reason) => {
          pendingDiscountRef.current?.();
          pendingDiscountRef.current = null;
          // Lưu otpId + reason vào activeTab để khi checkout sẽ ghi audit
          if (pos.activeTabId) {
            pos.attachDiscountAudit(pos.activeTabId, {
              otpId: verified.otpId,
              reason,
            });
          }
          toast({
            title: "Đã duyệt qua OTP",
            description: "Giảm giá đã được áp dụng (audit log lưu manager duyệt).",
            variant: "success",
          });
        }}
      />

      {/* Transfer table dialog */}
      <Dialog open={transferTableOpen} onOpenChange={setTransferTableOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon name="swap_horiz" size={16} /> Chuyển bàn
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-xs text-muted-foreground mb-3">
              Chọn bàn trống để chuyển đơn <b>{pos.activeTab?.label}</b> sang.
            </p>
            <div className="grid grid-cols-4 gap-2 max-h-[320px] overflow-y-auto">
              {tables
                .filter((t) => t.status === "available" && t.id !== pos.activeTab?.tableId)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleTransferTable(t.id)}
                    className="h-14 rounded-lg border border-status-success/40 bg-status-success/5 text-status-success font-semibold hover:bg-status-success/10 press-scale-sm transition-colors flex flex-col items-center justify-center"
                  >
                    <div className="text-xs opacity-70">Bàn</div>
                    <div className="text-lg">{t.tableNumber}</div>
                  </button>
                ))}
            </div>
            {tables.filter((t) => t.status === "available").length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-6">
                Không có bàn trống
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Keyboard help overlay (F1 / ?) */}
      <Dialog open={keyboardHelpOpen} onOpenChange={setKeyboardHelpOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Icon name="keyboard" size={16} /> Phím tắt
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-xs">
            {[
              ["F1 / ?", "Bảng phím tắt"],
              ["F3", "Tìm món"],
              ["F4", "Tìm khách hàng"],
              ["F9", "Thanh toán"],
              ["F10", "Gửi bếp"],
              ["Ctrl+T", "Thêm đơn mới"],
              ["Ctrl+W", "Đóng đơn hiện tại"],
              ["Ctrl+Tab", "Chuyển đơn tiếp"],
              ["Ctrl+Shift+Tab", "Chuyển đơn trước"],
              ["Esc", "Đóng popup"],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center justify-between py-0.5">
                <kbd className="px-2 py-0.5 bg-muted border rounded text-[11px] font-mono">{key}</kbd>
                <span className="text-foreground">{desc}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function FnbPosPage() {
  // Gate toàn page bằng permission pos_fnb.send_kitchen — nhân viên chỉ
  // truy cập được nếu role template của họ có quyền này.
  return (
    <PermissionPage requires={PERMISSIONS.POS_FNB_SEND_KITCHEN}>
      <FnbPosPageInner />
    </PermissionPage>
  );
}
