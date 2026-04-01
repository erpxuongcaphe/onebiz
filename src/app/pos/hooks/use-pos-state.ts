"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { CartItem, OrderTab, SaleMode, PaymentMethod } from "@/lib/types";
import { formatCurrency } from "@/lib/format";

// --- Mock Data ---

export const CATEGORIES = [
  { id: "all", name: "Tat ca" },
  { id: "cat-1", name: "Ca phe nguyen chat" },
  { id: "cat-2", name: "Ca phe pha tron" },
  { id: "cat-3", name: "Tra & do uong" },
  { id: "cat-4", name: "Vat tu" },
  { id: "cat-5", name: "Phu kien" },
  { id: "cat-6", name: "Nguyen lieu" },
];

export const PRODUCTS = [
  { id: "p1", name: "Ca phe Robusta rang xay", price: 85000, stock: 150, categoryId: "cat-1" },
  { id: "p2", name: "Ca phe Arabica Cau Dat", price: 120000, stock: 80, categoryId: "cat-1" },
  { id: "p3", name: "Ca phe Moka Lam Dong", price: 135000, stock: 45, categoryId: "cat-1" },
  { id: "p4", name: "Ca phe Culi nguyen chat", price: 95000, stock: 60, categoryId: "cat-1" },
  { id: "p5", name: "Ca phe Cherry dac biet", price: 160000, stock: 30, categoryId: "cat-1" },
  { id: "p6", name: "Ca phe sua 3in1 hop 20 goi", price: 65000, stock: 200, categoryId: "cat-2" },
  { id: "p7", name: "Ca phe tron bo hat", price: 75000, stock: 120, categoryId: "cat-2" },
  { id: "p8", name: "Ca phe tron cacao", price: 78000, stock: 90, categoryId: "cat-2" },
  { id: "p9", name: "Ca phe hoa tan Gold", price: 55000, stock: 300, categoryId: "cat-2" },
  { id: "p10", name: "Ca phe tron vanilla", price: 82000, stock: 75, categoryId: "cat-2" },
  { id: "p11", name: "Tra sen Tay Ho", price: 110000, stock: 50, categoryId: "cat-3" },
  { id: "p12", name: "Tra o long Dai Loan", price: 145000, stock: 40, categoryId: "cat-3" },
  { id: "p13", name: "Tra lai Thai Nguyen", price: 68000, stock: 100, categoryId: "cat-3" },
  { id: "p14", name: "Tra dao cam sa (goi)", price: 45000, stock: 180, categoryId: "cat-3" },
  { id: "p15", name: "Matcha latte bot", price: 95000, stock: 65, categoryId: "cat-3" },
  { id: "p16", name: "Sua dac Ong Tho thung", price: 320000, stock: 25, categoryId: "cat-6" },
  { id: "p17", name: "Sua tuoi TH True Milk thung", price: 285000, stock: 30, categoryId: "cat-6" },
  { id: "p18", name: "Duong cat trang 1kg", price: 22000, stock: 200, categoryId: "cat-6" },
  { id: "p19", name: "Bot kem beo Nestle 1kg", price: 85000, stock: 50, categoryId: "cat-6" },
  { id: "p20", name: "Syrup caramel Monin 700ml", price: 175000, stock: 35, categoryId: "cat-6" },
  { id: "p21", name: "Ly giay 12oz (50 cai)", price: 55000, stock: 100, categoryId: "cat-4" },
  { id: "p22", name: "Nap ly nhua (50 cai)", price: 25000, stock: 150, categoryId: "cat-4" },
  { id: "p23", name: "Ong hut giay (100 cai)", price: 35000, stock: 120, categoryId: "cat-4" },
  { id: "p24", name: "Tui zip dung ca phe 250g (100c)", price: 95000, stock: 80, categoryId: "cat-4" },
  { id: "p25", name: "Phin ca phe inox", price: 45000, stock: 60, categoryId: "cat-5" },
  { id: "p26", name: "Binh giu nhiet 500ml", price: 185000, stock: 25, categoryId: "cat-5" },
  { id: "p27", name: "May xay ca phe mini", price: 450000, stock: 10, categoryId: "cat-5" },
  { id: "p28", name: "Bo drip ca phe V60", price: 250000, stock: 15, categoryId: "cat-5" },
  { id: "p29", name: "Ca phe Honey Process", price: 195000, stock: 20, categoryId: "cat-1" },
  { id: "p30", name: "Cold Brew tui ngam (10 tui)", price: 88000, stock: 70, categoryId: "cat-2" },
];

export type Product = (typeof PRODUCTS)[0];

// --- Helpers ---

let cartItemCounter = 0;
function generateCartItemId() {
  return `ci-${++cartItemCounter}-${Date.now()}`;
}

function createEmptyTab(index: number): OrderTab {
  return {
    id: `tab-${Date.now()}-${index}`,
    label: `Hoa don ${index}`,
    cart: [],
    customerId: null,
    customerName: "Khach le",
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
  const [saleMode, setSaleMode] = useState<SaleMode>("quick");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [currentTime, setCurrentTime] = useState("");
  const [mobileView, setMobileView] = useState<"products" | "cart">("products");
  const [customerSearch, setCustomerSearch] = useState("");
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [discountValue, setDiscountValue] = useState(0);
  const [showDiscountInput, setShowDiscountInput] = useState(false);
  const [customerPayment, setCustomerPayment] = useState<string>("");
  const [addedProductId, setAddedProductId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // Active tab helpers
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const cart = activeTab.cart;

  const setCart = useCallback(
    (updater: CartItem[] | ((prev: CartItem[]) => CartItem[])) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab;
          const newCart = typeof updater === "function" ? updater(tab.cart) : updater;
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

  // F3 keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "F3") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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

  const discountAmount = useMemo(() => {
    if (discountType === "percent")
      return Math.round((subtotal * discountValue) / 100);
    return discountValue;
  }, [subtotal, discountValue, discountType]);

  const totalDue = Math.max(0, subtotal - discountAmount);

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
    setDiscountValue(0);
    setShowDiscountInput(false);
    setCustomerPayment("");
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
    setDiscountValue(0);
    setShowDiscountInput(false);
    setCustomerPayment("");
  }

  function handleCheckout() {
    if (cart.length === 0) return;
    const methodLabel =
      paymentMethod === "cash"
        ? "Tien mat"
        : paymentMethod === "transfer"
          ? "Chuyen khoan"
          : "The";
    alert(
      `Thanh toan thanh cong!\n\nTong: ${formatCurrency(totalDue)}d\nKhach dua: ${formatCurrency(customerPaymentNum)}d\nTien thua: ${formatCurrency(changeAmount)}d\nPhuong thuc: ${methodLabel}`
    );
    setCart([]);
    setDiscountValue(0);
    setShowDiscountInput(false);
    setCustomerPayment("");
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
    discountAmount,
    totalDue,
    customerPaymentNum,
    changeAmount,
    cartItemCount,

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
  };
}

export type PosState = ReturnType<typeof usePosState>;
