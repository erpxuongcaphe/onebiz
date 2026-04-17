"use client";

import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useAuth, useToast } from "@/lib/contexts";
import { useSettings } from "@/lib/contexts/settings-context";
import { getProductCategoriesAsync } from "@/lib/services/supabase/products";
import { getVariantsByProduct } from "@/lib/services/supabase/variants";
import { fnbPayment } from "@/lib/services/supabase/fnb-checkout";
import { getTablesByBranch, markTableAvailable } from "@/lib/services/supabase/fnb-tables";
import {
  useNetworkStatus,
  offlineSendToKitchen,
  offlineFnbPayment,
  prefetchMenuData,
  prefetchTableData,
  getMenuFromCache,
  getTablesFromCache,
  shouldRefreshMenu,
  hapticTap,
  hapticSuccess,
  hapticError,
} from "@/lib/offline";
import { splitByItems, splitEqually } from "@/lib/services/supabase/split-bill";
import { getKitchenOrderById } from "@/lib/services/supabase/kitchen-orders";
import { getOpenShift, openShift, closeShift } from "@/lib/services/supabase/shifts";
import { getClient } from "@/lib/services/supabase/base";
import { printKitchenTicketV2, printPreBill, printFnbReceipt } from "@/lib/print-fnb";
import type { RestaurantTable } from "@/lib/types/fnb";
import type { Shift } from "@/lib/types/shift";
import type { Customer } from "@/lib/types";
import { useFnbPosState } from "./hooks/use-fnb-pos-state";
import { FnbHeader } from "./components/fnb-header";
import { FnbCategoryTabs, type FnbCategory } from "./components/fnb-category-tabs";
import { FnbProductGrid, type FnbProduct } from "./components/fnb-product-grid";
import { FnbCart } from "./components/fnb-cart";
import type { FnbItemConfirmPayload } from "./components/fnb-item-dialog";
import type { FnbPaymentConfirmPayload } from "./components/fnb-payment-dialog";
import type { SplitItem } from "./components/split-bill-dialog";
import { ConnectionStatusBar } from "./components/connection-status-bar";
import { Icon } from "@/components/ui/icon";

// Lazy load heavy dialogs (only loaded when user opens them)
const FnbItemDialog = lazy(() => import("./components/fnb-item-dialog").then(m => ({ default: m.FnbItemDialog })));
const FnbPaymentDialog = lazy(() => import("./components/fnb-payment-dialog").then(m => ({ default: m.FnbPaymentDialog })));
const TableFloorPlan = lazy(() => import("./components/table-floor-plan").then(m => ({ default: m.TableFloorPlan })));
const SplitBillDialog = lazy(() => import("./components/split-bill-dialog").then(m => ({ default: m.SplitBillDialog })));
const OpenShiftDialog = lazy(() => import("./components/shift-dialog").then(m => ({ default: m.OpenShiftDialog })));
const CloseShiftDialog = lazy(() => import("./components/shift-dialog").then(m => ({ default: m.CloseShiftDialog })));
const FnbSearchModal = lazy(() => import("./components/fnb-search-modal").then(m => ({ default: m.FnbSearchModal })));
const FnbCustomerPicker = lazy(() => import("./components/fnb-customer-picker").then(m => ({ default: m.FnbCustomerPicker })));

export default function FnbPosPage() {
  const { user, tenant, currentBranch } = useAuth();
  const { toast } = useToast();
  const { settings } = useSettings();
  const networkStatus = useNetworkStatus();
  const pos = useFnbPosState();

  // ── Data state ──
  const [categories, setCategories] = useState<FnbCategory[]>([]);
  const [products, setProducts] = useState<FnbProduct[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Dialog state ──
  const [selectedProduct, setSelectedProduct] = useState<FnbProduct | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [itemVariants, setItemVariants] = useState<{ id: string; label: string; sell_price: number }[]>([]);
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

  const branchId = currentBranch?.id;
  const tenantId = tenant?.id ?? "";
  const userId = user?.id ?? "";

  // ── Load data (cache-first, then network refresh) ──
  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      setLoading(true);
      try {
        // Step 1: Load from IndexedDB cache instantly
        try {
          const cached = await getMenuFromCache();
          if (cached.products.length > 0) {
            setCategories(cached.categories);
            setProducts(cached.products);
            setToppingProducts(cached.toppings);
            setLoading(false); // Show cached data immediately
          }
          if (branchId) {
            const cachedTables = await getTablesFromCache(branchId);
            if (cachedTables.length > 0) {
              setTables(cachedTables as RestaurantTable[]);
            }
          }
        } catch {
          // IndexedDB not available — continue with network
        }

        // Step 2: Background refresh from Supabase (if online)
        if (networkStatus.isOnline) {
          const needsRefresh = await shouldRefreshMenu().catch(() => true);

          if (needsRefresh) {
            // Fetch fresh data
            const cats = await getProductCategoriesAsync("sku");
            const mappedCats = cats.map((c) => ({ id: c.value, name: c.label, code: c.value }));
            setCategories(mappedCats);

            const supabase = getClient();
            const { data: prods } = await supabase
              .from("products")
              .select("id, name, code, sell_price, image_url, stock, category_id")
              .eq("is_active", true)
              .eq("product_type", "sku")
              .eq("channel", "fnb")
              .order("name");
            setProducts(
              (prods ?? []).map((p) => ({
                id: p.id,
                name: p.name,
                code: p.code,
                sell_price: p.sell_price,
                image_url: (p as Record<string, unknown>).image_url as string | undefined,
                stock: p.stock,
                category_id: p.category_id,
              }))
            );

            const { data: toppings } = await supabase
              .from("products")
              .select("id, name, sell_price")
              .eq("is_active", true)
              .ilike("code", "NVL-TOP%");
            setToppingProducts(
              (toppings ?? []).map((t) => ({
                id: t.id,
                name: t.name,
                price: t.sell_price,
              }))
            );

            // Update cache in background
            prefetchMenuData().catch(() => {});
          }

          // Load tables + shift (always fresh when online)
          if (branchId) {
            const tbls = await getTablesByBranch(branchId);
            setTables(tbls);
            prefetchTableData(branchId).catch(() => {});
            if (userId) {
              const shift = await getOpenShift(branchId, userId);
              setCurrentShift(shift);
            }
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
  }, [tenantId, branchId, networkStatus.isOnline, toast]);

  // ── Filtered products ──
  const filteredProducts = useMemo(() => {
    if (!activeCategoryId) return products;
    return products.filter((p) => p.category_id === activeCategoryId);
  }, [products, activeCategoryId]);

  // ── Product select → open item dialog ──
  const handleSelectProduct = useCallback(
    async (product: FnbProduct) => {
      hapticTap();
      setSelectedProduct(product);
      // Load variants for this product
      try {
        const variants = await getVariantsByProduct(product.id);
        setItemVariants(
          variants.map((v) => ({
            id: v.id,
            label: v.name,
            sell_price: v.sellPrice,
          }))
        );
      } catch (err) {
        console.error("getVariantsByProduct error:", err);
        setItemVariants([]);
        toast({
          title: "Không tải được size/biến thể",
          description: "Món sẽ được thêm với giá chuẩn.",
          variant: "warning",
        });
      }
      setItemDialogOpen(true);
    },
    [toast]
  );

  // ── Add to cart from item dialog ──
  const handleItemConfirm = useCallback(
    (payload: FnbItemConfirmPayload) => {
      pos.addLine({
        productId: payload.productId,
        productName: payload.productName,
        variantId: payload.variantId,
        variantLabel: payload.variantLabel,
        quantity: payload.quantity,
        unitPrice: payload.unitPrice,
        toppings: payload.toppings,
        note: payload.note,
      });
      setItemDialogOpen(false);
    },
    [pos]
  );

  // ── Send to kitchen (offline-aware) ──
  const handleSendToKitchen = useCallback(async () => {
    const tab = pos.activeTab;
    if (!tab || tab.lines.length === 0) return;

    try {
      const result = await offlineSendToKitchen({
        tenantId,
        branchId: branchId!,
        createdBy: userId,
        tableId: tab.tableId,
        orderType: tab.orderType,
        items: tab.lines.map((l) => ({
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
        })),
      }, networkStatus.isOnline);

      pos.updateTabMeta(tab.id, { kitchenOrderId: result.kitchenOrderId });

      // Print kitchen ticket (auto-print if enabled in settings)
      if (settings.print.autoPrintKitchen) {
        printKitchenTicketV2({
          orderNumber: result.orderNumber ?? "—",
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
          createdAt: new Date().toISOString(),
          cashierName: user?.fullName,
          style: settings.print.kitchenTicketStyle,
          paperSize: settings.print.paperSize === "58mm" ? "58mm" : "80mm",
          isOffline: !networkStatus.isOnline,
        });
      }

      pos.clearCart();
      hapticSuccess();

      if (!networkStatus.isOnline) {
        toast({ title: "Đã lưu ngoại tuyến", description: `Đơn ${result.orderNumber} sẽ đồng bộ khi có mạng`, variant: "default" });
      } else {
        toast({ title: "Đã gửi bếp", description: `Đơn ${result.orderNumber ?? ""} đã gửi bếp thành công`, variant: "success" });
      }
    } catch (err) {
      hapticError();
      toast({ title: "Gửi bếp thất bại", description: (err as Error).message, variant: "error" });
    }
  }, [pos, tenantId, branchId, userId, toast, settings, user, networkStatus.isOnline]);

  // ── Print pre-bill ──
  const handlePrintPreBill = useCallback(() => {
    const tab = pos.activeTab;
    if (!tab || tab.lines.length === 0) return;

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
      total: pos.total,
      createdAt: new Date().toISOString(),
      cashierName: user?.fullName,
      storeName: settings.print.showStoreName ? settings.store.name : undefined,
      storeAddress: settings.print.showStoreAddress ? settings.store.address : undefined,
      storePhone: settings.print.showStorePhone ? settings.store.phone : undefined,
      paperSize: settings.print.paperSize === "58mm" ? "58mm" : "80mm",
      footer: settings.print.receiptFooter,
    });
  }, [pos, settings, user]);

  // ── Payment ──
  const handlePayment = useCallback(
    async (payload: FnbPaymentConfirmPayload) => {
      const tab = pos.activeTab;
      if (!tab?.kitchenOrderId && tab && tab.lines.length > 0) {
        // Direct payment without sending to kitchen first — send now
        await handleSendToKitchen();
      }

      const koId = pos.activeTab?.kitchenOrderId;
      if (!koId) return;

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
        }, networkStatus.isOnline);

        // Auto-print receipt if enabled.
        // Bọc print trong try/catch riêng: lỗi in KHÔNG được làm hỏng
        // flow thanh toán (payment đã success → không được hiển thị "Thanh toán thất bại").
        if (settings.print.autoPrintReceipt && tab) {
          try {
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
              total: pos.total,
              createdAt: new Date().toISOString(),
              cashierName: user?.fullName,
              paymentMethod: payload.paymentMethod,
              paid: payload.paid,
              change: Math.max(0, payload.paid - pos.total),
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
              } : undefined,
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

        setPaymentOpen(false);
        pos.closeTab(pos.activeTabId);
        hapticSuccess();

        if (!networkStatus.isOnline) {
          toast({ title: "Đã lưu thanh toán ngoại tuyến", description: "Sẽ đồng bộ khi có mạng", variant: "default" });
        } else {
          toast({ title: "Thanh toán thành công", variant: "success" });
          // Refresh tables từ server để đồng bộ status chính xác
          if (branchId) getTablesByBranch(branchId).then(setTables).catch(() => {});
        }
      } catch (err) {
        hapticError();
        toast({ title: "Thanh toán thất bại", description: (err as Error).message, variant: "error" });
      }
    },
    [pos, tenantId, branchId, userId, handleSendToKitchen, toast, settings, user, networkStatus.isOnline]
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
        }
      } else if (table.status === "cleaning") {
        markTableAvailable(table.id).then(() => {
          if (branchId) getTablesByBranch(branchId).then(setTables);
        });
      }
    },
    [pos]
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
      await closeShift({ shiftId: currentShift.id, actualCash, note });
      setCurrentShift(null);
      setCloseShiftDialogOpen(false);
    },
    [currentShift]
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
      await splitByItems(tab.kitchenOrderId, itemIds);
      // Create a new tab for the child order
      pos.createTab(`${tab.label}-B`, tab.orderType, tab.tableId);
    },
    [pos]
  );

  const handleSplitEqually = useCallback(
    async (numberOfWays: number) => {
      const tab = pos.activeTab;
      if (!tab?.kitchenOrderId) return;
      await splitEqually(tab.kitchenOrderId, numberOfWays);
      // Create tabs for child orders
      for (let i = 1; i < numberOfWays; i++) {
        const suffix = String.fromCharCode(65 + i);
        pos.createTab(`${tab.label}-${suffix}`, tab.orderType, tab.tableId);
      }
    },
    [pos]
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
      if (e.key === "F9" && (!inInput || (e.target as HTMLElement)?.dataset?.allowHotkeys === "true")) {
        e.preventDefault();
        if (pos.lineCount > 0) setPaymentOpen(true);
        return;
      }
      if (e.key === "F10" && (!inInput || (e.target as HTMLElement)?.dataset?.allowHotkeys === "true")) {
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

  // CEO chưa chọn chi nhánh → hiện layout POS với prompt chọn chi nhánh
  if (!branchId) {
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <FnbHeader
          tabs={[]}
          activeTabId=""
          switchTab={() => {}}
          closeTab={() => {}}
          createTab={() => {}}
          onToggleFloorPlan={() => {}}
          onSearch={() => setSearchModalOpen(true)}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Icon name="inventory_2" size={48} className="text-muted-foreground" />
          <p className="text-lg font-medium text-muted-foreground">
            Chọn chi nhánh trên thanh header để bắt đầu bán hàng
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <ConnectionStatusBar status={networkStatus} />
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
      />

      <div className="flex flex-1 min-h-0">
        {/* Left panel: menu grid OR floor plan */}
        <div className="flex-1 flex flex-col min-w-0">
          {showFloorPlan ? (
            <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Icon name="progress_activity" size={24} className="animate-spin text-gray-400" /></div>}>
              <TableFloorPlan
                tables={tables}
                onSelectTable={handleTableSelect}
              />
            </Suspense>
          ) : (
            <>
              <FnbCategoryTabs
                categories={categories}
                activeCategoryId={activeCategoryId}
                onSelect={setActiveCategoryId}
              />
              <div className="flex-1 overflow-y-auto p-3">
                <FnbProductGrid
                  products={filteredProducts}
                  onSelectProduct={handleSelectProduct}
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
          onSendToKitchen={handleSendToKitchen}
          onPayment={() => setPaymentOpen(true)}
          onSplitBill={handleOpenSplitBill}
          onCustomerClick={() => setCustomerPickerOpen(true)}
          onDiscountChange={(d) => pos.setOrderDiscount(pos.activeTabId, d)}
          onPrintPreBill={handlePrintPreBill}
        />
      </div>

      {/* Item dialog — lazy loaded */}
      {itemDialogOpen && (
        <Suspense fallback={null}>
          <FnbItemDialog
            open={itemDialogOpen}
            onOpenChange={setItemDialogOpen}
            product={selectedProduct}
            variants={itemVariants.length > 0 ? itemVariants : undefined}
            toppings={toppingProducts.length > 0 ? toppingProducts : undefined}
            onConfirm={handleItemConfirm}
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

      {/* Search modal (F3) — lazy loaded */}
      {searchModalOpen && (
        <Suspense fallback={null}>
          <FnbSearchModal
            open={searchModalOpen}
            products={products}
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

      {/* Mobile cart overlay */}
      {mobileCartOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex flex-col bg-white">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
            <span className="text-sm font-semibold">Giỏ hàng</span>
            <button
              type="button"
              onClick={() => setMobileCartOpen(false)}
              className="h-8 w-8 rounded flex items-center justify-center hover:bg-gray-200"
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
              onSendToKitchen={() => { handleSendToKitchen(); setMobileCartOpen(false); }}
              onPayment={() => { setPaymentOpen(true); setMobileCartOpen(false); }}
              onSplitBill={handleOpenSplitBill}
              onCustomerClick={() => setCustomerPickerOpen(true)}
              onDiscountChange={(d) => pos.setOrderDiscount(pos.activeTabId, d)}
              onPrintPreBill={handlePrintPreBill}
              mobile
            />
          </div>
        </div>
      )}

      {/* Mobile cart FAB */}
      {!mobileCartOpen && pos.lineCount > 0 && (
        <button
          type="button"
          onClick={() => setMobileCartOpen(true)}
          className="fixed bottom-4 right-4 z-30 lg:hidden h-14 w-14 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center hover:bg-blue-700 transition-colors"
        >
          <Icon name="shopping_cart" size={24} />
          <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">
            {pos.lineCount}
          </span>
        </button>
      )}

      {/* Keyboard help overlay (F1 / ?) */}
      {keyboardHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setKeyboardHelpOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-[360px] max-w-[90vw] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Icon name="keyboard" size={16} /> Phím tắt
              </h3>
              <button type="button" onClick={() => setKeyboardHelpOpen(false)} className="text-gray-400 hover:text-gray-600">
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="space-y-1.5 text-xs">
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
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border rounded text-[11px] font-mono">{key}</kbd>
                  <span className="text-gray-600">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
