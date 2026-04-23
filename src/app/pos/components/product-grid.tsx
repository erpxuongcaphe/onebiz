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
      .catch(() => {});
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
    <div className="flex flex-col h-full bg-surface-container-low">
      {/* ── Category pills ── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto border-b bg-white shrink-0 scrollbar-none">
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

      {/* ── Product tiles grid ── */}
      <div className="flex-1 overflow-y-auto p-2">
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
          // Giãn grid — trước đây 2xl:grid-cols-7 dày đặc, tên SP truncate, giá
          // chữ nhỏ. CEO phản ánh "quá nhiều món thông tin bán thì ít và nép bên phải".
          // Giảm 1 cột ở mỗi breakpoint lg+ + tăng gap → mỗi tile rộng hơn, dễ đọc.
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
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

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col bg-white rounded border border-border overflow-hidden transition-all text-left group",
        "hover:border-primary hover:shadow active:scale-[0.97]",
        outOfStock && "opacity-60"
      )}
    >
      {/* Image — compact 3:2 ratio */}
      <div className="relative aspect-[3/2] bg-surface-container-low flex items-center justify-center overflow-hidden">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            className="h-full w-full object-cover group-hover:scale-105 transition-transform"
            loading="lazy"
          />
        ) : (
          <Icon name="inventory_2" className="text-gray-300" />
        )}
        {outOfStock && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
            <span className="text-[9px] font-bold text-status-error bg-status-error/10 px-1.5 py-0.5 rounded-full border border-status-error/25">
              Hết hàng
            </span>
          </div>
        )}
        {/* Stock badge — always show when in stock (KiotViet style) */}
        {!outOfStock && (
          <div className="absolute top-0.5 right-0.5">
            <span className={cn(
              "text-[8px] font-medium px-1 py-0.5 rounded-full border",
              stock <= 5
                ? "text-status-warning bg-status-warning/10 border-status-warning/25"
                : "text-muted-foreground bg-white/80 border-border"
            )}>
              {stock}
            </span>
          </div>
        )}
      </div>

      {/* Info — tăng font-size để dễ đọc trên tablet POS */}
      <div className="px-2 py-1.5 flex-1 flex flex-col min-h-[44px]">
        <p className="text-xs font-medium text-foreground line-clamp-2 leading-tight flex-1">
          {product.name}
        </p>
        <div className="flex items-center justify-between mt-1 gap-1">
          <p className="text-xs font-bold text-primary">
            {formatCurrency(product.sellPrice ?? 0)}
          </p>
          {product.code && (
            <p className="text-[9px] text-muted-foreground font-mono truncate max-w-[60px]">
              {product.code}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
