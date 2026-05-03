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
              Square POS / KiotViet quen thuộc với cashier. ── */}
      <aside className="hidden md:flex flex-col w-40 lg:w-44 xl:w-48 border-r bg-white shrink-0 overflow-y-auto">
        <div className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b sticky top-0 bg-white z-10">
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
          // Auto-fit grid (CSS Tricks pattern): khi ít SP, cards stretch để fill
          // row → không trống bên phải. Khi nhiều SP, cards thu lại 180px → nhiều
          // cols. Một dòng CSS thay 6 breakpoint fixed cols.
          // Mobile <md: giữ grid-cols-2/3 cho touch UX quen thuộc.
          <div
            className={cn(
              "grid grid-cols-2 sm:grid-cols-3 gap-2.5",
              "md:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]",
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
// Full-width clickable, label trái + count phải, active: nền primary + border-l-4.
// Height 36px → tap thoải mái với chuột desktop, đủ lớn cho tablet.
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
        "group flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors border-l-4 shrink-0",
        active
          ? "bg-primary-fixed text-primary font-semibold border-l-primary"
          : "border-l-transparent text-foreground/80 hover:bg-surface-container-low hover:text-foreground",
      )}
    >
      <span className="truncate flex-1">{label}</span>
      {typeof count === "number" && (
        <span
          className={cn(
            "shrink-0 text-[11px] tabular-nums px-1.5 py-0.5 rounded",
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

// ── Product tile card — KiotViet-style with stock + code ──
function ProductTile({
  product,
  onClick,
}: {
  product: Product;
  onClick: () => void;
}) {
  const outOfStock = (product.stock ?? 0) <= 0;
  const stock = product.stock ?? 0;
  // Stock subtle — chỉ hiện khi LOW (≤5) hoặc OUT. Ngừng đếm số xanh ở mọi
  // card vì che bớt image + nhiễu visual (KiotViet làm vậy gây rối). Cashier
  // chỉ cần warning khi sắp hết.
  const showStockChip = outOfStock || stock <= 5;

  // Placeholder gradient + chữ đầu — pattern Square POS. Khi không có image,
  // dùng gradient theo hash tên SP để mỗi SP có 1 màu nhất định, dễ scan.
  const initial = (product.name?.[0] ?? "?").toUpperCase();
  const hue = hashHue(product.name ?? "");

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col bg-white rounded-lg border border-border overflow-hidden transition-all text-left group press-scale-sm",
        "hover:border-primary hover:shadow-md hover:-translate-y-0.5",
        outOfStock && "opacity-60",
      )}
    >
      {/* Image — aspect 4:3 cân đối hơn 3:2 (cao hơn 16% → có chỗ thở cho image) */}
      <div className="relative aspect-[4/3] flex items-center justify-center overflow-hidden">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
          />
        ) : (
          // Gradient placeholder + chữ cái đầu lớn — trông sang trọng hơn icon đen.
          // Hue ổn định theo tên SP (cùng SP luôn cùng màu, dễ nhận diện).
          <div
            className="h-full w-full flex items-center justify-center font-heading font-bold text-white/90 select-none"
            style={{
              background: `linear-gradient(135deg, hsl(${hue} 65% 55%) 0%, hsl(${(hue + 30) % 360} 60% 45%) 100%)`,
              fontSize: "min(48px, 30%)",
            }}
            aria-hidden
          >
            {initial}
          </div>
        )}
        {outOfStock && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center">
            <span className="text-[10px] font-bold text-status-error bg-white px-2 py-0.5 rounded-full border border-status-error/30 shadow-sm">
              Hết hàng
            </span>
          </div>
        )}
        {/* Stock chip — góc trên phải, chỉ khi LOW. */}
        {showStockChip && !outOfStock && (
          <div className="absolute top-1.5 right-1.5">
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-status-warning/90 text-white shadow-sm">
              Còn {stock}
            </span>
          </div>
        )}
      </div>

      {/* Info — typography hierarchy rõ: name → price (nổi bật) → code (mờ) */}
      <div className="px-2.5 py-2 flex-1 flex flex-col gap-1">
        <p className="text-[13px] font-medium text-foreground line-clamp-2 leading-snug flex-1">
          {product.name}
        </p>
        <div className="flex items-baseline justify-between gap-1.5">
          <p className="text-[15px] font-bold text-primary tabular-nums">
            {formatCurrency(product.sellPrice ?? 0)}
          </p>
          {product.code && (
            <p className="text-[10px] text-muted-foreground/80 font-mono truncate max-w-[80px]">
              {product.code}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

/**
 * Hash tên SP → hue 0-360 ổn định. Cùng tên luôn cùng màu → cashier nhớ
 * vị trí theo màu (visual memory). Algorithm: simple djb2 → mod 360.
 */
function hashHue(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}
