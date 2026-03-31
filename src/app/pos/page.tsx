"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  Plus,
  Minus,
  X,
  Trash2,
  User,
  ChevronLeft,
  Clock,
  ShoppingCart,
  CreditCard,
  Banknote,
  ArrowLeftRight,
  Barcode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

// --- Types ---

interface CartItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  price: number;
  discount: number;
}

interface OrderTab {
  id: string;
  label: string;
  cart: CartItem[];
  customerId: string | null;
  customerName: string;
}

type SaleMode = "quick" | "normal" | "delivery";
type PaymentMethod = "cash" | "transfer" | "card";

// --- Mock Data ---

const CATEGORIES = [
  { id: "all", name: "Tat ca" },
  { id: "cat-1", name: "Ca phe nguyen chat" },
  { id: "cat-2", name: "Ca phe pha tron" },
  { id: "cat-3", name: "Tra & do uong" },
  { id: "cat-4", name: "Vat tu" },
  { id: "cat-5", name: "Phu kien" },
  { id: "cat-6", name: "Nguyen lieu" },
];

const PRODUCTS = [
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

function roundUpTo(value: number, nearest: number): number {
  return Math.ceil(value / nearest) * nearest;
}

// --- Component ---

export default function PosPage() {
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

  function addToCart(product: (typeof PRODUCTS)[0]) {
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

  // --- Render ---

  return (
    <div className="flex flex-col h-full">
      {/* ==================== TOP BAR ==================== */}
      <div className="h-10 bg-[hsl(217,91%,40%)] flex items-center px-2 text-white shrink-0 gap-2">
        {/* Left: Logo + Back */}
        <Link
          href="/"
          className="flex items-center gap-1 text-white/90 hover:text-white text-sm shrink-0 mr-2"
        >
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">Quan ly</span>
        </Link>
        <span className="font-bold text-sm shrink-0 hidden md:inline mr-2">
          OneBiz POS
        </span>

        {/* Center: Order Tabs */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto mx-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={cn(
                "flex items-center gap-1 px-3 h-7 rounded text-xs whitespace-nowrap shrink-0 transition-colors",
                tab.id === activeTabId
                  ? "bg-white/20 text-white font-medium"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              )}
            >
              <span>{tab.label}</span>
              {tab.cart.length > 0 && (
                <span className="bg-white/30 text-[10px] rounded-full px-1.5 leading-4">
                  {tab.cart.reduce((s, i) => s + i.quantity, 0)}
                </span>
              )}
              {tabs.length > 1 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="ml-0.5 hover:bg-white/20 rounded-full p-0.5 leading-none cursor-pointer"
                >
                  <X className="size-3" />
                </span>
              )}
            </button>
          ))}
          <button
            onClick={addTab}
            className="shrink-0 size-7 flex items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Plus className="size-4" />
          </button>
        </div>

        {/* Right: Sale Mode + Clock + Avatar */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Sale mode toggle - desktop only */}
          <div className="hidden lg:flex items-center bg-white/10 rounded h-7 overflow-hidden">
            {(
              [
                { key: "quick", label: "Ban nhanh" },
                { key: "normal", label: "Ban thuong" },
                { key: "delivery", label: "Giao hang" },
              ] as const
            ).map((mode) => (
              <button
                key={mode.key}
                onClick={() => setSaleMode(mode.key)}
                className={cn(
                  "px-2.5 h-full text-xs whitespace-nowrap transition-colors",
                  saleMode === mode.key
                    ? "bg-white/25 text-white font-medium"
                    : "text-white/70 hover:text-white"
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {/* Clock */}
          <div className="hidden sm:flex items-center gap-1 text-xs text-white/80 ml-2">
            <Clock className="size-3.5" />
            <span className="font-mono w-[60px]">{currentTime}</span>
          </div>

          {/* User avatar */}
          <div className="size-7 rounded-full bg-white/20 flex items-center justify-center ml-1">
            <User className="size-4 text-white/80" />
          </div>
        </div>
      </div>

      {/* ==================== MAIN CONTENT ==================== */}
      <div className="flex-1 flex min-h-0">
        {/* ========= LEFT PANEL - Products ========= */}
        <div
          className={cn(
            "flex-1 flex flex-col min-w-0 bg-gray-50",
            mobileView === "cart" ? "hidden md:flex" : "flex"
          )}
        >
          {/* Search Bar */}
          <div className="p-2 bg-white border-b flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tim hang hoa (F3)"
                className="pl-9 pr-9 h-9"
              />
              <Barcode className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground cursor-pointer hover:text-primary transition-colors" />
            </div>
          </div>

          {/* Category Pills */}
          <div className="px-2 py-1.5 bg-white border-b">
            <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pb-0.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={cn(
                    "shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors",
                    selectedCategory === cat.id
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Product Grid */}
          <ScrollArea className="flex-1">
            <div className="p-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className={cn(
                    "bg-white border rounded-lg p-3 text-left hover:shadow-md hover:border-primary/30 transition-all duration-150 active:scale-[0.97]",
                    addedProductId === product.id &&
                      "ring-2 ring-primary/50 scale-[0.97]"
                  )}
                >
                  <div className="text-sm font-medium line-clamp-2 min-h-[2.5rem] leading-tight">
                    {product.name}
                  </div>
                  <div className="mt-1.5 text-sm font-bold text-primary">
                    {formatCurrency(product.price)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Ton: {product.stock}
                  </div>
                </button>
              ))}
              {filteredProducts.length === 0 && (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  Khong tim thay san pham
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ========= RIGHT PANEL - Cart ========= */}
        <div
          className={cn(
            "w-full md:w-[380px] lg:w-[420px] border-l flex flex-col bg-white shrink-0",
            mobileView === "products" ? "hidden md:flex" : "flex"
          )}
        >
          {/* Customer Section */}
          <div className="p-2 border-b space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <User className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Tim khach hang"
                  className="pl-7 h-8 text-sm"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-xs h-8"
              >
                <Plus className="size-3 mr-1" />
                Tao KH
              </Button>
            </div>
            <div className="flex items-center gap-2 px-1">
              <User className="size-3.5 text-blue-500" />
              <span className="text-sm font-medium">
                {activeTab.customerName}
              </span>
            </div>
          </div>

          {/* Cart Items */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="divide-y">
              {cart.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <ShoppingCart className="size-10 mb-2 opacity-30" />
                  <p className="text-sm">Chua co san pham</p>
                </div>
              )}
              {cart.map((item, index) => (
                <CartItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  onUpdateQuantity={updateQuantity}
                  onUpdatePrice={updatePrice}
                  onUpdateDiscount={updateItemDiscount}
                  onRemove={removeFromCart}
                />
              ))}
            </div>
          </ScrollArea>

          {/* ===== Order Summary ===== */}
          <div className="border-t bg-white shrink-0">
            <div className="p-2.5 space-y-1.5 text-sm">
              {/* Subtotal */}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tong tien hang</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>

              {/* Discount */}
              <div className="flex justify-between items-center">
                <button
                  onClick={() => setShowDiscountInput(!showDiscountInput)}
                  className="text-muted-foreground hover:text-primary text-sm flex items-center gap-1"
                >
                  Giam gia
                  {!showDiscountInput && <Plus className="size-3" />}
                </button>
                {discountAmount > 0 && (
                  <span className="text-red-500">
                    -{formatCurrency(discountAmount)}
                  </span>
                )}
              </div>
              {showDiscountInput && (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    value={discountValue || ""}
                    onChange={(e) =>
                      setDiscountValue(parseInt(e.target.value) || 0)
                    }
                    className="h-7 text-sm flex-1"
                    placeholder="0"
                  />
                  <div className="flex bg-gray-100 rounded overflow-hidden h-7">
                    <button
                      onClick={() => setDiscountType("fixed")}
                      className={cn(
                        "px-2 text-xs transition-colors",
                        discountType === "fixed"
                          ? "bg-primary text-white"
                          : "hover:bg-gray-200"
                      )}
                    >
                      d
                    </button>
                    <button
                      onClick={() => setDiscountType("percent")}
                      className={cn(
                        "px-2 text-xs transition-colors",
                        discountType === "percent"
                          ? "bg-primary text-white"
                          : "hover:bg-gray-200"
                      )}
                    >
                      %
                    </button>
                  </div>
                </div>
              )}

              {/* Total Due */}
              <div className="flex justify-between items-baseline pt-1.5 border-t">
                <span className="font-semibold">Khach can tra</span>
                <span className="text-xl font-bold text-primary">
                  {formatCurrency(totalDue)}
                </span>
              </div>

              {/* Customer Payment */}
              <div className="space-y-1.5 pt-1">
                <span className="text-muted-foreground text-xs">
                  Tien khach dua
                </span>
                <Input
                  type="number"
                  value={customerPayment}
                  onChange={(e) => setCustomerPayment(e.target.value)}
                  placeholder={formatCurrency(totalDue)}
                  className="h-9 text-right font-medium text-base"
                />

                {/* Quick amount buttons */}
                {totalDue > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    <button
                      onClick={() => setCustomerPayment(totalDue.toString())}
                      className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs hover:bg-blue-100 transition-colors font-medium"
                    >
                      {formatCurrency(totalDue)}
                    </button>
                    {[10000, 20000, 50000, 100000, 200000, 500000]
                      .map((amt) => roundUpTo(totalDue, amt))
                      .filter(
                        (rounded, i, arr) =>
                          rounded > totalDue &&
                          rounded <= totalDue * 3 &&
                          arr.indexOf(rounded) === i
                      )
                      .slice(0, 4)
                      .map((rounded) => (
                        <button
                          key={rounded}
                          onClick={() =>
                            setCustomerPayment(rounded.toString())
                          }
                          className="px-2 py-1 rounded bg-gray-100 text-xs hover:bg-gray-200 transition-colors"
                        >
                          {formatCurrency(rounded)}
                        </button>
                      ))}
                  </div>
                )}

                {/* Change */}
                {customerPaymentNum > totalDue && totalDue > 0 && (
                  <div className="flex justify-between text-sm pt-0.5">
                    <span className="text-muted-foreground">Tien thua</span>
                    <span className="font-medium text-green-600">
                      {formatCurrency(changeAmount)}
                    </span>
                  </div>
                )}
              </div>

              {/* Payment Method */}
              <div className="flex gap-1.5 pt-1.5">
                {(
                  [
                    { key: "cash", label: "Tien mat", icon: Banknote },
                    {
                      key: "transfer",
                      label: "Chuyen khoan",
                      icon: ArrowLeftRight,
                    },
                    { key: "card", label: "The", icon: CreditCard },
                  ] as const
                ).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setPaymentMethod(key)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-medium border transition-colors",
                      paymentMethod === key
                        ? "bg-primary/10 border-primary text-primary"
                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                    )}
                  >
                    <Icon className="size-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>

              {/* Checkout Button */}
              <Button
                onClick={handleCheckout}
                disabled={cart.length === 0}
                className="w-full h-12 bg-green-600 hover:bg-green-700 text-white text-base font-bold rounded-lg border-0 disabled:opacity-50 mt-1"
              >
                THANH TOAN
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ========= Mobile Floating Cart Button ========= */}
      <div className="md:hidden fixed bottom-4 right-4 z-50">
        {mobileView === "products" ? (
          <button
            onClick={() => setMobileView("cart")}
            className="relative bg-primary text-white rounded-full size-14 flex items-center justify-center shadow-lg hover:bg-primary/90 active:scale-95 transition-all"
          >
            <ShoppingCart className="size-6" />
            {cartItemCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 font-bold">
                {cartItemCount}
              </span>
            )}
          </button>
        ) : (
          <button
            onClick={() => setMobileView("products")}
            className="bg-primary text-white rounded-full size-14 flex items-center justify-center shadow-lg hover:bg-primary/90 active:scale-95 transition-all"
          >
            <Search className="size-6" />
          </button>
        )}
      </div>
    </div>
  );
}

// --- Cart Item Row Component ---

function CartItemRow({
  item,
  index,
  onUpdateQuantity,
  onUpdatePrice,
  onUpdateDiscount,
  onRemove,
}: {
  item: CartItem;
  index: number;
  onUpdateQuantity: (id: string, qty: number) => void;
  onUpdatePrice: (id: string, price: number) => void;
  onUpdateDiscount: (id: string, discount: number) => void;
  onRemove: (id: string) => void;
}) {
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(item.price.toString());
  const [showItemDiscount, setShowItemDiscount] = useState(item.discount > 0);
  const lineTotal = item.quantity * item.price - item.discount;

  return (
    <div className="group px-2 py-2 hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-2">
        {/* Row number */}
        <span className="text-xs text-muted-foreground mt-1 w-4 shrink-0 text-right">
          {index + 1}
        </span>

        {/* Item details */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate pr-6">{item.name}</div>
          <div className="flex items-center gap-2 mt-1.5">
            {/* Quantity controls */}
            <div className="flex items-center border rounded h-7">
              <button
                onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                className="px-1.5 h-full hover:bg-gray-100 transition-colors rounded-l"
              >
                <Minus className="size-3" />
              </button>
              <input
                type="number"
                value={item.quantity}
                onChange={(e) =>
                  onUpdateQuantity(item.id, parseInt(e.target.value) || 1)
                }
                className="w-10 h-full text-center text-sm border-x bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                className="px-1.5 h-full hover:bg-gray-100 transition-colors rounded-r"
              >
                <Plus className="size-3" />
              </button>
            </div>

            <span className="text-xs text-muted-foreground">x</span>

            {/* Editable unit price */}
            {editingPrice ? (
              <input
                type="number"
                autoFocus
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                onBlur={() => {
                  onUpdatePrice(item.id, parseInt(priceInput) || item.price);
                  setEditingPrice(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onUpdatePrice(
                      item.id,
                      parseInt(priceInput) || item.price
                    );
                    setEditingPrice(false);
                  }
                  if (e.key === "Escape") {
                    setPriceInput(item.price.toString());
                    setEditingPrice(false);
                  }
                }}
                className="w-20 h-6 text-xs border rounded px-1 text-right outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            ) : (
              <button
                onClick={() => {
                  setPriceInput(item.price.toString());
                  setEditingPrice(true);
                }}
                className="text-xs text-muted-foreground hover:text-primary hover:underline"
              >
                {formatCurrency(item.price)}
              </button>
            )}

            {/* Line total */}
            <span className="ml-auto text-sm font-semibold whitespace-nowrap">
              {formatCurrency(lineTotal)}
            </span>
          </div>

          {/* Per-item discount */}
          <div className="mt-1">
            {!showItemDiscount ? (
              <button
                onClick={() => setShowItemDiscount(true)}
                className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
              >
                + Giam gia
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground shrink-0">
                  Giam:
                </span>
                <input
                  type="number"
                  value={item.discount || ""}
                  onChange={(e) =>
                    onUpdateDiscount(item.id, parseInt(e.target.value) || 0)
                  }
                  className="w-20 h-5 text-[11px] border rounded px-1 outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="0"
                />
                <button
                  onClick={() => {
                    onUpdateDiscount(item.id, 0);
                    setShowItemDiscount(false);
                  }}
                  className="text-muted-foreground hover:text-red-500 transition-colors"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Delete button */}
        <button
          onClick={() => onRemove(item.id)}
          className="mt-0.5 p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
