"use client";

/**
 * ProductGrid — KiotViet-style product browsing panel
 *
 * Top: horizontal scrollable category pills
 * Body: responsive tile grid (image + name + price)
 * Clicking a tile fires onAddProduct
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { Product, ProductCategory } from "@/lib/types";
import { getProducts } from "@/lib/services/supabase/products";
import { getCategoriesByScope } from "@/lib/services/supabase/categories";
import { Icon } from "@/components/ui/icon";

interface ProductGridProps {
  searchQuery: string;
  onAddProduct: (product: Product) => void;
}

export function ProductGrid({ searchQuery, onAddProduct }: ProductGridProps) {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalProducts, setTotalProducts] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Fetch categories on mount ----
  useEffect(() => {
    getCategoriesByScope("sku")
      .then((cats) => setCategories(cats))
      .catch((err) =>
        console.error("[POS] product-grid getCategoriesByScope failed:", err),
      );
  }, []);

  // ---- Fetch products (debounced when search changes) ----
  const fetchProducts = useCallback(
    async (catId: string, search: string) => {
      setLoading(true);
      try {
        // Retail POS chỉ hiển thị SKU channel='retail' (hàng đóng gói bán lẻ/sỉ).
        // Món FnB pha chế tại quán (channel='fnb') được POS FnB xử lý riêng.
        const filters: Record<string, string | string[]> = {
          status: "active",
          channel: "retail",
        };
        if (catId !== "all") filters.category = catId;
        const result = await getProducts({
          page: 0,
          pageSize: 50,
          search: search || undefined,
          sortBy: "name",
          sortOrder: "asc",
          filters,
        });
        setProducts(result.data);
        setTotalProducts(result.total);
      } catch {
        setProducts([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchProducts(selectedCategory, searchQuery);
    }, searchQuery ? 250 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedCategory, searchQuery, fetchProducts]);

  // ---- Filter: only products with sell_price > 0 for POS ----
  const displayProducts = useMemo(
    () => products.filter((p) => (p.sellPrice ?? 0) > 0),
    [products]
  );

  return (
    <div className="flex flex-col md:flex-row h-full bg-surface-container-low">
      {/* ── Mobile: horizontal pills (giữ pattern cũ cho <md, cashier mobile
              quen tap pill ngang). Desktop: ẩn để dùng vertical sidebar. ── */}
      <div className="md:hidden flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto border-b bg-white shrink-0 scrollbar-none">
        <CategoryPill
          label="Tất cả"
          count={totalProducts}
          active={selectedCategory === "all"}
          onClick={() => setSelectedCategory("all")}
        />
        {categories.map((cat) => (
          <CategoryPill
            key={cat.id}
            label={cat.name}
            count={cat.productCount}
            active={selectedCategory === cat.id}
            onClick={() => setSelectedCategory(cat.id)}
          />
        ))}
      </div>

      {/* ── Desktop+: vertical sidebar trái — list full-width tap target lớn,
              count align right, active state primary nền + border-l-4. Pattern
              Square POS / KiotViet quen thuộc với cashier.
              Adaptive width: hơi rộng hơn để tên "Rang xay đóng gói" hiện đủ
              hoặc wrap 2 dòng (CEO 04/05 báo "Rang xay đó..." truncate). ── */}
      <aside
        className="hidden md:flex flex-col border-r bg-white shrink-0 overflow-y-auto"
        style={{ width: "clamp(132px, 10vw, 180px)" }}
      >
        <div className="px-2.5 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b sticky top-0 bg-white z-10">
          Danh mục
        </div>
        <CategoryRow
          label="Tất cả"
          count={totalProducts}
          active={selectedCategory === "all"}
          onClick={() => setSelectedCategory("all")}
        />
        {categories.map((cat) => (
          <CategoryRow
            key={cat.id}
            label={cat.name}
            count={cat.productCount}
            active={selectedCategory === cat.id}
            onClick={() => setSelectedCategory(cat.id)}
          />
        ))}
      </aside>

      {/* ── Product tiles grid ── */}
      <div className="flex-1 overflow-y-auto p-2 min-w-0">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Icon name="progress_activity" className="animate-spin text-primary" />
          </div>
        ) : displayProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <Icon name="inventory_2" size={32} className="mb-2" />
            <p className="text-xs">
              {searchQuery
                ? "Không tìm thấy sản phẩm"
                : "Danh mục trống"}
            </p>
          </div>
        ) : (
          // Auto-fit grid: card C compact (thumb 40×40 + info bên phải), min
          // 160px → 4-6 cols tuỳ width. Mobile giữ 2/3 cols vertical card.
          <div
            className={cn(
              "grid grid-cols-2 sm:grid-cols-3 gap-2",
              "md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]",
            )}
          >
            {displayProducts.map((product) => (
              <ProductTile
                key={product.id}
                product={product}
                onClick={() => onAddProduct(product)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Vertical sidebar row (desktop+) ──
// CEO 04/05: tên "Rang xay đóng gói" trước truncate "Rang xay đó..." → cho
// phép wrap 2 dòng với line-clamp-2, text-xs (12px) thay text-sm để vừa hơn.
// Tap target vẫn ≥40px (tablet OK) qua min-h-[40px] + leading-tight.
function CategoryRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center justify-between gap-1.5 px-2.5 py-1.5 min-h-[40px] text-xs text-left transition-colors border-l-4 shrink-0",
        active
          ? "bg-primary-fixed text-primary font-semibold border-l-primary"
          : "border-l-transparent text-foreground/80 hover:bg-surface-container-low hover:text-foreground",
      )}
      title={label}
    >
      <span className="line-clamp-2 flex-1 leading-tight">{label}</span>
      {typeof count === "number" && (
        <span
          className={cn(
            "shrink-0 text-[10.5px] tabular-nums px-1 py-0.5 rounded",
            active
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground group-hover:text-foreground/70",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ── Category pill button ──
function CategoryPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all whitespace-nowrap",
        active
          ? "bg-primary text-white shadow-sm"
          : "bg-muted text-foreground hover:bg-muted"
      )}
    >
      {label}
      {typeof count === "number" && (
        <span
          className={cn(
            "ml-1 text-[10px]",
            active ? "text-primary-fixed" : "text-muted-foreground"
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ── Product tile card C — compact horizontal (thumb 40 + info) ──
// CEO không thích gradient màu trên placeholder → dùng background xám
// neutral với icon nhỏ. Card compact ~76px height thay vì 270px.
function ProductTile({
  product,
  onClick,
}: {
  product: Product;
  onClick: () => void;
}) {
  const outOfStock = (product.stock ?? 0) <= 0;
  const stock = product.stock ?? 0;
  const showStockChip = outOfStock || stock <= 5;

  return (
    <button
      type="button"
      onClick={onClick}
      title={product.name}
      className={cn(
        "flex items-center gap-2 bg-white rounded-lg border border-border p-2 text-left transition-all press-scale-sm min-h-[60px]",
        "hover:border-primary hover:shadow-sm",
        outOfStock && "opacity-60",
      )}
    >
      {/* Thumb 40×40 vuông — image hoặc placeholder neutral (xám nhạt + icon). */}
      <div className="relative h-10 w-10 shrink-0 rounded-md bg-surface-container-low flex items-center justify-center overflow-hidden">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <Icon name="inventory_2" size={18} className="text-muted-foreground/40" />
        )}
      </div>

      {/* Info: tên (line-clamp-2) → price + (code|stock chip) */}
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium text-foreground line-clamp-2 leading-tight mb-0.5">
          {product.name}
        </p>
        <div className="flex items-center justify-between gap-1">
          <p className="text-[13px] font-bold text-primary tabular-nums">
            {formatCurrency(product.sellPrice ?? 0)}
          </p>
          {outOfStock ? (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-status-error/10 text-status-error border border-status-error/20 shrink-0">
              Hết
            </span>
          ) : showStockChip ? (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-status-warning/15 text-status-warning shrink-0">
              Còn {stock}
            </span>
          ) : product.code ? (
            <p className="text-[9px] text-muted-foreground/70 font-mono truncate max-w-[64px]">
              {product.code}
            </p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/**
 * Hash tên SP → hue 0-360 ổn định. Reserved cho future use nếu cần
 * color hint per category — không dùng ở Card C compact (CEO không
 * thích gradient màu).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function hashHue(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}
