"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type {
  CartItem,
  OrderTab,
  SaleMode,
  PaymentMethod,
  ShippingInfo,
  CouponInfo,
} from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { useAuth, useToast } from "@/lib/contexts";
import { posCheckout, validateCoupon } from "@/lib/services";
import { createClient } from "@/lib/supabase/client";

// --- Product type from Supabase ---
export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  categoryId: string;
  image: string;
}

export interface Category {
  id: string;
  name: string;
}

// Mock delivery partners (will be from DB later)
export const DELIVERY_PARTNERS = [
  { id: "ghn", name: "Giao Hàng Nhanh" },
  { id: "ghtk", name: "Giao Hàng Tiết Kiệm" },
  { id: "viettel", name: "Viettel Post" },
  { id: "jt", name: "J&T Express" },
  { id: "best", name: "BEST Express" },
  { id: "ninja", name: "Ninja Van" },
  { id: "self", name: "Tự giao hàng" },
];

// --- Helpers ---

let cartItemCounter = 0;
function generateCartItemId() {
  return `ci-${++cartItemCounter}-${Date.now()}`;
}

function createEmptyTab(index: number): OrderTab {
  return {
    id: `tab-${Date.now()}-${index}`,
    label: `Hóa đơn ${index}`,
    cart: [],
    customerId: null,
    customerName: "Khách lẻ",
  };
}

function createDefaultShipping(): ShippingInfo {
  return {
    recipientName: "",
    recipientPhone: "",
    recipientAddress: "",
    deliveryPartnerId: "",
    deliveryPartnerName: "",
    shippingFee: 0,
    codAmount: 0,
    isCod: false,
    note: "",
  };
}

export function roundUpTo(value: number, nearest: number): number {
  return Math.ceil(value / nearest) * nearest;
}

// --- Hook ---

export function usePosState() {
  const { user, currentBranch } = useAuth();
  const { toast } = useToast();

  // Products & Categories from Supabase
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);

  // Load products and categories from Supabase
  useEffect(() => {
    async function loadProducts() {
      const supabase = createClient();
      const [{ data: prodData }, { data: catData }] = await Promise.all([
        supabase
          .from("products")
          .select("id, name, sell_price, stock, category_id, image_url")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("categories")
          .select("id, name")
          .order("name"),
      ]);

      setProducts(
        (prodData ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          price: p.sell_price ?? 0,
          stock: p.stock ?? 0,
          categoryId: p.category_id ?? "",
          image: p.image_url ?? "",
        }))
      );

      setCategories([
        { id: "all", name: "Tất cả" },
        ...(catData ?? []).map((c) => ({ id: c.id, name: c.name })),
      ]);

      setProductsLoading(false);
    }
    loadProducts();
  }, []);

  // Order tabs
  const [tabs, setTabs] = useState<OrderTab[]>(() => [createEmptyTab(1)]);
  const [activeTabId, setActiveTabId] = useState(() => `tab-${Date.now()}-1`);

  useEffect(() => {
    setActiveTabId(tabs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // UI state
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [saleMode, setSaleMode] = useState<SaleMode>("normal");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [currentTime, setCurrentTime] = useState("");
  const [mobileView, setMobileView] = useState<"products" | "cart">("products");
  const [customerSearch, setCustomerSearch] = useState("");
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [discountValue, setDiscountValue] = useState(0);
  const [showDiscountInput, setShowDiscountInput] = useState(false);
  const [customerPayment, setCustomerPayment] = useState<string>("");
  const [addedProductId, setAddedProductId] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  // Coupon state
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<CouponInfo | null>(null);
  const [couponError, setCouponError] = useState("");

  // Shipping state
  const [shipping, setShipping] = useState<ShippingInfo>(createDefaultShipping());

  const searchRef = useRef<HTMLInputElement>(null);

  // Active tab helpers
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const cart = activeTab.cart;

  const setCart = useCallback(
    (updater: CartItem[] | ((prev: CartItem[]) => CartItem[])) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab;
          const newCart =
            typeof updater === "function" ? updater(tab.cart) : updater;
          return { ...tab, cart: newCart };
        })
      );
    },
    [activeTabId]
  );

  // Clock
  useEffect(() => {
    function tick() {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "F3") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "F9") {
        e.preventDefault();
        handleCheckout();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory =
        selectedCategory === "all" || p.categoryId === selectedCategory;
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        !query ||
        p.name.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery, products]);

  // Cart calculations
  const subtotal = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + item.quantity * item.price - item.discount,
        0
      ),
    [cart]
  );

  const orderDiscountAmount = useMemo(() => {
    if (discountType === "percent")
      return Math.round((subtotal * discountValue) / 100);
    return discountValue;
  }, [subtotal, discountValue, discountType]);

  const couponDiscountAmount = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.minOrderAmount && subtotal < appliedCoupon.minOrderAmount)
      return 0;
    let amount =
      appliedCoupon.type === "percent"
        ? Math.round((subtotal * appliedCoupon.value) / 100)
        : appliedCoupon.value;
    if (appliedCoupon.maxDiscountAmount) {
      amount = Math.min(amount, appliedCoupon.maxDiscountAmount);
    }
    return amount;
  }, [appliedCoupon, subtotal]);

  const totalDiscount = orderDiscountAmount + couponDiscountAmount;
  const shippingFee = saleMode === "delivery" ? shipping.shippingFee : 0;
  const totalDue = Math.max(0, subtotal - totalDiscount + shippingFee);

  const customerPaymentNum =
    customerPayment === "" ? totalDue : parseInt(customerPayment) || 0;
  const changeAmount = Math.max(0, customerPaymentNum - totalDue);

  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // --- Actions ---

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [
        ...prev,
        {
          id: generateCartItemId(),
          productId: product.id,
          name: product.name,
          quantity: 1,
          price: product.price,
          discount: 0,
        },
      ];
    });
    setAddedProductId(product.id);
    setTimeout(() => setAddedProductId(null), 300);
    if (saleMode === "quick") {
      setMobileView("cart");
    }
  }

  function removeFromCart(cartItemId: string) {
    setCart((prev) => prev.filter((item) => item.id !== cartItemId));
  }

  function updateQuantity(cartItemId: string, newQty: number) {
    if (newQty <= 0) {
      removeFromCart(cartItemId);
      return;
    }
    setCart((prev) =>
      prev.map((item) =>
        item.id === cartItemId ? { ...item, quantity: newQty } : item
      )
    );
  }

  function updatePrice(cartItemId: string, newPrice: number) {
    setCart((prev) =>
      prev.map((item) =>
        item.id === cartItemId ? { ...item, price: newPrice } : item
      )
    );
  }

  function updateItemDiscount(cartItemId: string, discount: number) {
    setCart((prev) =>
      prev.map((item) =>
        item.id === cartItemId ? { ...item, discount } : item
      )
    );
  }

  function addTab() {
    const newIndex = tabs.length + 1;
    const newTab = createEmptyTab(newIndex);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    resetOrderState();
  }

  function closeTab(tabId: string) {
    if (tabs.length <= 1) return;
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(filtered[0].id);
      }
      return filtered;
    });
  }

  function switchTab(tabId: string) {
    setActiveTabId(tabId);
    resetOrderState();
  }

  function resetOrderState() {
    setDiscountValue(0);
    setShowDiscountInput(false);
    setCustomerPayment("");
    setAppliedCoupon(null);
    setCouponCode("");
    setCouponError("");
    setShipping(createDefaultShipping());
  }

  // Coupon actions — use Supabase validate_coupon RPC
  async function applyCoupon() {
    if (!couponCode.trim()) {
      setCouponError("Vui lòng nhập mã giảm giá");
      return;
    }
    try {
      const result = await validateCoupon(
        couponCode.trim(),
        subtotal,
        activeTab.customerId ?? undefined
      );
      if (!result.valid) {
        setCouponError(result.error ?? "Mã giảm giá không hợp lệ");
        return;
      }
      setAppliedCoupon({
        code: couponCode.trim().toUpperCase(),
        type: result.type === "percent" ? "percent" : "fixed",
        value: result.value ?? 0,
        maxDiscountAmount: result.discount_amount ?? undefined,
        minOrderAmount: undefined,
      });
      setCouponError("");
    } catch {
      setCouponError("Mã giảm giá không hợp lệ");
    }
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setCouponCode("");
    setCouponError("");
  }

  function updateShipping(updates: Partial<ShippingInfo>) {
    setShipping((prev) => ({ ...prev, ...updates }));
  }

  // Real checkout: write to Supabase
  async function handleCheckout() {
    if (cart.length === 0) return;
    if (checkingOut) return;

    if (!user?.tenantId || !currentBranch?.id) {
      toast({
        title: "Lỗi",
        description: "Không xác định được chi nhánh. Vui lòng đăng nhập lại.",
        variant: "error",
      });
      return;
    }

    setCheckingOut(true);
    try {
      const result = await posCheckout({
        tenantId: user.tenantId,
        branchId: currentBranch.id,
        createdBy: user.id,
        customerId: activeTab.customerId,
        customerName: activeTab.customerName ?? "Khách lẻ",
        items: cart.map((item) => ({
          productId: item.productId,
          productName: item.name,
          quantity: item.quantity,
          unitPrice: item.price,
          discount: item.discount,
        })),
        paymentMethod,
        subtotal,
        discountAmount: totalDiscount,
        total: totalDue,
        paid: customerPaymentNum,
        note: appliedCoupon
          ? `Mã giảm giá: ${appliedCoupon.code}`
          : undefined,
      });

      toast({
        title: "Thanh toán thành công!",
        description: `Hóa đơn ${result.invoiceCode} - ${formatCurrency(totalDue)}`,
        variant: "success",
      });

      setCart([]);
      resetOrderState();
    } catch (err) {
      toast({
        title: "Lỗi thanh toán",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setCheckingOut(false);
    }
  }

  return {
    // State
    tabs,
    activeTabId,
    selectedCategory,
    searchQuery,
    saleMode,
    paymentMethod,
    currentTime,
    mobileView,
    customerSearch,
    discountType,
    discountValue,
    showDiscountInput,
    customerPayment,
    addedProductId,
    searchRef,
    activeTab,
    cart,
    filteredProducts,
    subtotal,
    orderDiscountAmount,
    couponDiscountAmount,
    totalDiscount,
    shippingFee,
    totalDue,
    customerPaymentNum,
    changeAmount,
    cartItemCount,
    checkingOut,

    // Products & Categories
    products,
    categories,
    productsLoading,

    // Coupon
    couponCode,
    appliedCoupon,
    couponError,

    // Shipping
    shipping,

    // Setters
    setSelectedCategory,
    setSearchQuery,
    setSaleMode,
    setPaymentMethod,
    setMobileView,
    setCustomerSearch,
    setDiscountType,
    setDiscountValue,
    setShowDiscountInput,
    setCustomerPayment,
    setCouponCode,

    // Actions
    addToCart,
    removeFromCart,
    updateQuantity,
    updatePrice,
    updateItemDiscount,
    addTab,
    closeTab,
    switchTab,
    handleCheckout,
    applyCoupon,
    removeCoupon,
    updateShipping,
  };
}

export type PosState = ReturnType<typeof usePosState>;
