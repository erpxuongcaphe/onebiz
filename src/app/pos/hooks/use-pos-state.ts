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

// --- Mock Data ---

export const CATEGORIES = [
  { id: "all", name: "Tất cả" },
  { id: "cat-1", name: "Cà phê nguyên chất" },
  { id: "cat-2", name: "Cà phê pha trộn" },
  { id: "cat-3", name: "Trà & đồ uống" },
  { id: "cat-4", name: "Vật tư" },
  { id: "cat-5", name: "Phụ kiện" },
  { id: "cat-6", name: "Nguyên liệu" },
];

export const PRODUCTS = [
  { id: "p1", name: "Cà phê Robusta rang xay", price: 85000, stock: 150, categoryId: "cat-1", image: "" },
  { id: "p2", name: "Cà phê Arabica Cầu Đất", price: 120000, stock: 80, categoryId: "cat-1", image: "" },
  { id: "p3", name: "Cà phê Moka Lâm Đồng", price: 135000, stock: 45, categoryId: "cat-1", image: "" },
  { id: "p4", name: "Cà phê Culi nguyên chất", price: 95000, stock: 60, categoryId: "cat-1", image: "" },
  { id: "p5", name: "Cà phê Cherry đặc biệt", price: 160000, stock: 30, categoryId: "cat-1", image: "" },
  { id: "p6", name: "Cà phê sữa 3in1 hộp 20 gói", price: 65000, stock: 200, categoryId: "cat-2", image: "" },
  { id: "p7", name: "Cà phê trộn bơ hạt", price: 75000, stock: 120, categoryId: "cat-2", image: "" },
  { id: "p8", name: "Cà phê trộn cacao", price: 78000, stock: 90, categoryId: "cat-2", image: "" },
  { id: "p9", name: "Cà phê hòa tan Gold", price: 55000, stock: 300, categoryId: "cat-2", image: "" },
  { id: "p10", name: "Cà phê trộn vanilla", price: 82000, stock: 75, categoryId: "cat-2", image: "" },
  { id: "p11", name: "Trà sen Tây Hồ", price: 110000, stock: 50, categoryId: "cat-3", image: "" },
  { id: "p12", name: "Trà ô long Đài Loan", price: 145000, stock: 40, categoryId: "cat-3", image: "" },
  { id: "p13", name: "Trà lài Thái Nguyên", price: 68000, stock: 100, categoryId: "cat-3", image: "" },
  { id: "p14", name: "Trà đào cam sả (gói)", price: 45000, stock: 180, categoryId: "cat-3", image: "" },
  { id: "p15", name: "Matcha latte bột", price: 95000, stock: 65, categoryId: "cat-3", image: "" },
  { id: "p16", name: "Sữa đặc Ông Thọ thùng", price: 320000, stock: 25, categoryId: "cat-6", image: "" },
  { id: "p17", name: "Sữa tươi TH True Milk thùng", price: 285000, stock: 30, categoryId: "cat-6", image: "" },
  { id: "p18", name: "Đường cát trắng 1kg", price: 22000, stock: 200, categoryId: "cat-6", image: "" },
  { id: "p19", name: "Bột kem béo Nestle 1kg", price: 85000, stock: 50, categoryId: "cat-6", image: "" },
  { id: "p20", name: "Syrup caramel Monin 700ml", price: 175000, stock: 35, categoryId: "cat-6", image: "" },
  { id: "p21", name: "Ly giấy 12oz (50 cái)", price: 55000, stock: 100, categoryId: "cat-4", image: "" },
  { id: "p22", name: "Nắp ly nhựa (50 cái)", price: 25000, stock: 150, categoryId: "cat-4", image: "" },
  { id: "p23", name: "Ống hút giấy (100 cái)", price: 35000, stock: 120, categoryId: "cat-4", image: "" },
  { id: "p24", name: "Túi zip đựng cà phê 250g (100c)", price: 95000, stock: 80, categoryId: "cat-4", image: "" },
  { id: "p25", name: "Phin cà phê inox", price: 45000, stock: 60, categoryId: "cat-5", image: "" },
  { id: "p26", name: "Bình giữ nhiệt 500ml", price: 185000, stock: 25, categoryId: "cat-5", image: "" },
  { id: "p27", name: "Máy xay cà phê mini", price: 450000, stock: 10, categoryId: "cat-5", image: "" },
  { id: "p28", name: "Bộ drip cà phê V60", price: 250000, stock: 15, categoryId: "cat-5", image: "" },
  { id: "p29", name: "Cà phê Honey Process", price: 195000, stock: 20, categoryId: "cat-1", image: "" },
  { id: "p30", name: "Cold Brew túi ngâm (10 túi)", price: 88000, stock: 70, categoryId: "cat-2", image: "" },
];

export type Product = (typeof PRODUCTS)[0];

// Mock delivery partners
export const DELIVERY_PARTNERS = [
  { id: "ghn", name: "Giao Hàng Nhanh" },
  { id: "ghtk", name: "Giao Hàng Tiết Kiệm" },
  { id: "viettel", name: "Viettel Post" },
  { id: "jt", name: "J&T Express" },
  { id: "best", name: "BEST Express" },
  { id: "ninja", name: "Ninja Van" },
  { id: "self", name: "Tự giao hàng" },
];

// Mock coupons
const MOCK_COUPONS: CouponInfo[] = [
  { code: "GIAM10", type: "percent", value: 10, maxDiscountAmount: 50000 },
  { code: "GIAM20K", type: "fixed", value: 20000, minOrderAmount: 100000 },
  { code: "FREESHIP", type: "fixed", value: 30000 },
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
  // Order tabs
  const [tabs, setTabs] = useState<OrderTab[]>(() => [createEmptyTab(1)]);
  const [activeTabId, setActiveTabId] = useState(() => `tab-${Date.now()}-1`);

  // Ensure activeTabId is synced on first render
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

  // Coupon state
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<CouponInfo | null>(null);
  const [couponError, setCouponError] = useState("");

  // Shipping state (for delivery mode)
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
      // F9 = checkout
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
    return PRODUCTS.filter((p) => {
      const matchesCategory =
        selectedCategory === "all" || p.categoryId === selectedCategory;
      const matchesSearch =
        !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.id.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

  // Cart calculations
  const subtotal = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + item.quantity * item.price - item.discount,
        0
      ),
    [cart]
  );

  // Order discount (manual)
  const orderDiscountAmount = useMemo(() => {
    if (discountType === "percent")
      return Math.round((subtotal * discountValue) / 100);
    return discountValue;
  }, [subtotal, discountValue, discountType]);

  // Coupon discount
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
    // On mobile quick mode, switch to cart after adding
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

  // Coupon actions
  function applyCoupon() {
    if (!couponCode.trim()) {
      setCouponError("Vui lòng nhập mã giảm giá");
      return;
    }
    const found = MOCK_COUPONS.find(
      (c) => c.code.toLowerCase() === couponCode.trim().toLowerCase()
    );
    if (!found) {
      setCouponError("Mã giảm giá không hợp lệ");
      return;
    }
    if (found.minOrderAmount && subtotal < found.minOrderAmount) {
      setCouponError(
        `Đơn hàng tối thiểu ${formatCurrency(found.minOrderAmount)}`
      );
      return;
    }
    setAppliedCoupon(found);
    setCouponError("");
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setCouponCode("");
    setCouponError("");
  }

  // Shipping actions
  function updateShipping(updates: Partial<ShippingInfo>) {
    setShipping((prev) => ({ ...prev, ...updates }));
  }

  function handleCheckout() {
    if (cart.length === 0) return;
    const methodLabel =
      paymentMethod === "cash"
        ? "Tiền mặt"
        : paymentMethod === "transfer"
          ? "Chuyển khoản"
          : "Thẻ";

    let message = `Thanh toán thành công!\n\nTổng: ${formatCurrency(totalDue)}\nKhách đưa: ${formatCurrency(customerPaymentNum)}\nTiền thừa: ${formatCurrency(changeAmount)}\nPhương thức: ${methodLabel}`;

    if (saleMode === "delivery") {
      message += `\n\nGiao hàng:\nNgười nhận: ${shipping.recipientName}\nSĐT: ${shipping.recipientPhone}\nĐịa chỉ: ${shipping.recipientAddress}\nĐối tác: ${shipping.deliveryPartnerName || "Chưa chọn"}\nPhí ship: ${formatCurrency(shipping.shippingFee)}\nCOD: ${shipping.isCod ? formatCurrency(shipping.codAmount) : "Không"}`;
    }

    if (appliedCoupon) {
      message += `\nMã giảm giá: ${appliedCoupon.code} (-${formatCurrency(couponDiscountAmount)})`;
    }

    alert(message);
    setCart([]);
    resetOrderState();
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
