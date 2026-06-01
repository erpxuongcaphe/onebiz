"use client";

/**
 * MOCKUP — POS F&B Design Showcase (populated)
 * Route: /mockup/pos-fnb
 *
 * CEO 29/05/2026: "em hãy tự làm những mockup và hãy xem lại design cho pos
 * để xem ux ui". Tenant đang 0 món/0 bàn/0 danh mục nên màn POS FnB thật mở
 * ra trông trống → cảm giác "tệ". Mockup này DÙNG CHÍNH component production
 * (FnbCategorySidebar / FnbProductGrid / FnbCart) + bơm thực đơn cà phê mẫu +
 * giỏ hàng có món, để CEO thấy ĐÚNG giao diện POS của mình khi đầy dữ liệu.
 *
 * Không đụng data thật. Không auth-sensitive. Bấm thử được:
 *   - Đổi danh mục (lọc lưới món)
 *   - Bấm món → thêm vào giỏ
 *   - +/- số lượng, xoá món
 *   - Đổi loại đơn (tại quán / mang về / giao hàng)
 *   - Nhập giảm giá
 */

import { useMemo, useState } from "react";
import {
  FnbCategorySidebar,
  type FnbCategoryWithCount,
} from "../../pos/fnb/components/fnb-category-sidebar";
import {
  FnbProductGrid,
  type FnbProduct,
} from "../../pos/fnb/components/fnb-product-grid";
import { FnbCart } from "../../pos/fnb/components/fnb-cart";
import type {
  FnbTabSnapshot,
  FnbOrderLine,
  FnbDiscountInput,
  OrderType,
} from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";
import { formatCurrency } from "@/lib/format";

// ─────────────────────────────────────────────────────────────
// Sample data — thực đơn quán cà phê (đầy đủ dấu tiếng Việt)
// ─────────────────────────────────────────────────────────────
const CATEGORIES: { id: string; name: string; code: string }[] = [
  { id: "c-cafe", name: "Cà phê", code: "CAFE" },
  { id: "c-trasua", name: "Trà sữa", code: "TS" },
  { id: "c-tra", name: "Trà trái cây", code: "TRA" },
  { id: "c-daxay", name: "Đá xay", code: "DX" },
  { id: "c-nuocep", name: "Nước ép", code: "NEP" },
  { id: "c-banh", name: "Bánh ngọt", code: "BANH" },
  { id: "c-topping", name: "Topping", code: "TOP" },
  { id: "c-combo", name: "Combo", code: "CB" },
];

type MenuSeed = { name: string; price: number; cat: string };
const MENU: MenuSeed[] = [
  // Cà phê
  { name: "Cà phê đen đá", price: 25000, cat: "c-cafe" },
  { name: "Cà phê sữa đá", price: 29000, cat: "c-cafe" },
  { name: "Bạc xỉu", price: 35000, cat: "c-cafe" },
  { name: "Cà phê muối", price: 39000, cat: "c-cafe" },
  { name: "Cappuccino", price: 45000, cat: "c-cafe" },
  { name: "Latte", price: 45000, cat: "c-cafe" },
  { name: "Cold Brew", price: 49000, cat: "c-cafe" },
  { name: "Espresso", price: 35000, cat: "c-cafe" },
  // Trà sữa
  { name: "Trà sữa trân châu đường đen", price: 45000, cat: "c-trasua" },
  { name: "Trà sữa truyền thống", price: 39000, cat: "c-trasua" },
  { name: "Trà sữa khoai môn", price: 42000, cat: "c-trasua" },
  { name: "Trà sữa matcha", price: 45000, cat: "c-trasua" },
  { name: "Hồng trà sữa", price: 39000, cat: "c-trasua" },
  { name: "Trà sữa socola", price: 42000, cat: "c-trasua" },
  // Trà trái cây
  { name: "Trà đào cam sả", price: 45000, cat: "c-tra" },
  { name: "Trà vải", price: 42000, cat: "c-tra" },
  { name: "Trà tắc", price: 32000, cat: "c-tra" },
  { name: "Trà ổi hồng", price: 45000, cat: "c-tra" },
  { name: "Trà chanh giã tay", price: 35000, cat: "c-tra" },
  // Đá xay
  { name: "Matcha đá xay", price: 55000, cat: "c-daxay" },
  { name: "Socola đá xay", price: 55000, cat: "c-daxay" },
  { name: "Cookie đá xay", price: 59000, cat: "c-daxay" },
  { name: "Cà phê đá xay", price: 52000, cat: "c-daxay" },
  // Nước ép
  { name: "Nước ép cam", price: 39000, cat: "c-nuocep" },
  { name: "Nước ép dứa", price: 39000, cat: "c-nuocep" },
  { name: "Nước ép cà rốt", price: 39000, cat: "c-nuocep" },
  { name: "Detox dưa hấu", price: 45000, cat: "c-nuocep" },
  // Bánh ngọt
  { name: "Bánh tiramisu", price: 45000, cat: "c-banh" },
  { name: "Bánh mousse chanh dây", price: 42000, cat: "c-banh" },
  { name: "Croissant bơ", price: 32000, cat: "c-banh" },
  { name: "Bánh phô mai nướng", price: 39000, cat: "c-banh" },
  { name: "Cookie socola", price: 22000, cat: "c-banh" },
  // Topping
  { name: "Trân châu đen", price: 7000, cat: "c-topping" },
  { name: "Trân châu trắng", price: 7000, cat: "c-topping" },
  { name: "Thạch phô mai", price: 8000, cat: "c-topping" },
  { name: "Pudding trứng", price: 8000, cat: "c-topping" },
  { name: "Kem cheese", price: 10000, cat: "c-topping" },
  { name: "Đào miếng", price: 10000, cat: "c-topping" },
  // Combo
  { name: "Combo 2 cà phê + bánh", price: 99000, cat: "c-combo" },
  { name: "Combo nhóm 4 ly", price: 159000, cat: "c-combo" },
  { name: "Combo trà sữa đôi", price: 79000, cat: "c-combo" },
];

const PRODUCTS: FnbProduct[] = MENU.map((m, i) => ({
  id: `p-${i}`,
  name: m.name,
  code: `SP${String(i + 1).padStart(3, "0")}`,
  sell_price: m.price,
  stock: 100,
  category_id: m.cat,
  brand: null,
}));

// Giỏ hàng mẫu — Bàn 5, có vài món + 1 topping để CEO thấy cart đầy
const INITIAL_LINES: FnbOrderLine[] = [
  {
    id: "l-1",
    productId: "p-1",
    productName: "Cà phê sữa đá",
    quantity: 2,
    unitPrice: 29000,
    toppings: [],
    lineTotal: 58000,
  },
  {
    id: "l-2",
    productId: "p-2",
    productName: "Bạc xỉu",
    quantity: 1,
    unitPrice: 35000,
    toppings: [],
    lineTotal: 35000,
  },
  {
    id: "l-3",
    productId: "p-8",
    productName: "Trà sữa trân châu đường đen",
    quantity: 1,
    unitPrice: 45000,
    toppings: [{ productId: "p-32", name: "Trân châu đen", quantity: 1, price: 7000 }],
    note: "Ít đá, 70% đường",
    lineTotal: 52000,
  },
];

function lineTotalOf(line: FnbOrderLine): number {
  const toppingSum = line.toppings.reduce((s, t) => s + t.price * t.quantity, 0);
  return line.unitPrice * line.quantity + toppingSum;
}

export default function PosFnbMockupPage() {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [discount, setDiscount] = useState<FnbDiscountInput | undefined>(undefined);
  const [lines, setLines] = useState<FnbOrderLine[]>(INITIAL_LINES);

  const categoriesWithCount: FnbCategoryWithCount[] = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        ...c,
        count: PRODUCTS.filter((p) => p.category_id === c.id).length,
      })),
    [],
  );

  const filteredProducts = useMemo(
    () =>
      activeCategoryId
        ? PRODUCTS.filter((p) => p.category_id === activeCategoryId)
        : PRODUCTS,
    [activeCategoryId],
  );

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.lineTotal, 0),
    [lines],
  );
  const orderDiscountAmount = useMemo(() => {
    if (!discount || discount.value <= 0) return 0;
    if (discount.mode === "percent")
      return Math.round((subtotal * Math.min(discount.value, 100)) / 100);
    return Math.min(discount.value, subtotal);
  }, [discount, subtotal]);
  const total = Math.max(0, subtotal - orderDiscountAmount);
  const lineCount = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines]);

  // Phase 1A.1: pass qty map xuống FnbProductGrid để demo badge số lượng
  // trên ô món. Cùng prop sẽ chạy ở POS thật khi cashier thêm món.
  const cartQtyByProductId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of lines) {
      map[l.productId] = (map[l.productId] ?? 0) + l.quantity;
    }
    return map;
  }, [lines]);

  // Bấm món → thêm vào giỏ (gộp nếu đã có, không topping)
  function handleSelectProduct(p: FnbProduct) {
    setLines((prev) => {
      const existing = prev.find(
        (l) => l.productId === p.id && l.toppings.length === 0 && !l.note,
      );
      if (existing) {
        return prev.map((l) =>
          l.id === existing.id
            ? { ...l, quantity: l.quantity + 1, lineTotal: lineTotalOf({ ...l, quantity: l.quantity + 1 }) }
            : l,
        );
      }
      const line: FnbOrderLine = {
        id: `l-${Date.now()}-${p.id}`,
        productId: p.id,
        productName: p.name,
        quantity: 1,
        unitPrice: p.sell_price,
        toppings: [],
        lineTotal: p.sell_price,
      };
      return [...prev, line];
    });
  }

  function updateLineQty(lineId: string, qty: number) {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => l.id !== lineId)
        : prev.map((l) =>
            l.id === lineId
              ? { ...l, quantity: qty, lineTotal: lineTotalOf({ ...l, quantity: qty }) }
              : l,
          ),
    );
  }
  function removeLine(lineId: string) {
    setLines((prev) => prev.filter((l) => l.id !== lineId));
  }

  const activeTab: FnbTabSnapshot = {
    id: "tab-demo",
    label: orderType === "dine_in" ? "Bàn 5" : orderType === "delivery" ? "Giao #1" : "Mang về #1",
    orderType,
    customerName: "Khách lẻ",
    orderDiscount: discount,
    lines,
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Mockup banner */}
      <div className="shrink-0 flex items-center gap-2 bg-primary-fixed px-4 py-1.5 text-xs text-primary">
        <Icon name="palette" size={14} />
        <span className="font-semibold">MOCKUP minh hoạ</span>
        <span className="opacity-80">
          — dữ liệu mẫu, KHÔNG ảnh hưởng hệ thống thật. Bấm thử: đổi danh mục · bấm món vào giỏ · +/- · đổi loại đơn · nhập giảm giá.
        </span>
      </div>

      {/* Mock top bar — giống POS thật */}
      <header className="shrink-0 border-b border-outline-variant/20 bg-card/95 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary">
            <Icon name="local_cafe" size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="font-heading text-base font-bold leading-tight">
              Quán Cà Phê OneBiz — Chi nhánh Demo
            </h1>
            <p className="text-[11px] text-muted-foreground">Ca sáng · Thu ngân: Demo</p>
          </div>

          {/* Table tabs giả lập */}
          <div className="ml-4 hidden items-center gap-1 md:flex">
            {["Bàn 5", "Mang về #1", "Bàn 12"].map((t, i) => (
              <div
                key={t}
                className={
                  i === 0
                    ? "rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary"
                    : "rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-1.5 text-xs font-medium text-on-surface-variant"
                }
              >
                {t}
              </div>
            ))}
            <div className="flex size-8 items-center justify-center rounded-lg border border-dashed border-outline-variant/40 text-muted-foreground">
              <Icon name="add" size={16} />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-1.5 text-xs font-medium text-on-surface-variant">
              <Icon name="grid_view" size={14} className="mr-1 inline-block align-text-bottom" />
              Sơ đồ bàn
            </div>
            <div className="rounded-lg bg-surface-container px-3 py-1.5 font-heading text-lg font-bold tabular-nums">
              09:24
            </div>
          </div>
        </div>
      </header>

      {/* 3-panel layout — giống production */}
      <div className="flex flex-1 min-h-0">
        {/* Left: category sidebar */}
        <div className="hidden lg:block">
          <FnbCategorySidebar
            categories={categoriesWithCount}
            totalCount={PRODUCTS.length}
            activeCategoryId={activeCategoryId}
            onSelect={setActiveCategoryId}
          />
        </div>

        {/* Middle: product grid */}
        <div className="flex flex-1 min-w-0 flex-col">
          <div className="flex-1 min-h-0">
            <FnbProductGrid
              products={filteredProducts}
              onSelectProduct={handleSelectProduct}
              cartQtyByProductId={cartQtyByProductId}
            />
          </div>
        </div>

        {/* Right: cart (component production thật) */}
        <FnbCart
          activeTab={activeTab}
          subtotal={subtotal}
          total={total}
          orderDiscountAmount={orderDiscountAmount}
          lineCount={lineCount}
          updateLineQty={updateLineQty}
          removeLine={removeLine}
          onSendToKitchen={() => {}}
          onPayment={() => {}}
          onCustomerClick={() => {}}
          onOrderHistory={() => {}}
          onPrintPreBill={() => {}}
          onChangeOrderType={(next) => setOrderType(next)}
          onDiscountChange={(d) => setDiscount(d)}
        />
      </div>

      {/* Footer note — tổng quan đánh giá nhanh */}
      <div className="shrink-0 border-t border-outline-variant/20 bg-surface-container-lowest px-4 py-1.5 text-[11px] text-muted-foreground">
        Tạm tính {formatCurrency(subtotal)} · {lineCount} món · Đây là thiết kế POS hiện tại (production) với dữ liệu mẫu —
        điểm yếu lớn nhất khi dùng thật là <b className="text-foreground">thiếu ảnh món</b> (ô hình chỉ là icon mặc định).
      </div>
    </div>
  );
}
