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
    <div className="flex flex-col h-full bg-gray-50">
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
            <Icon name="progress_activity" className="animate-spin text-blue-500" />
          </div>
        ) : displayProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <Icon name="inventory_2" size={32} className="mb-2" />
            <p className="text-xs">
              {searchQuery
                ? "Không tìm thấy sản phẩm"
                : "Danh mục trống"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-1.5">
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
          ? "bg-blue-600 text-white shadow-sm"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      )}
    >
      {label}
      {typeof count === "number" && (
        <span
          className={cn(
            "ml-1 text-[10px]",
            active ? "text-blue-200" : "text-gray-400"
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
        "flex flex-col bg-white rounded border border-gray-200 overflow-hidden transition-all text-left group",
        "hover:border-blue-400 hover:shadow active:scale-[0.97]",
        outOfStock && "opacity-60"
      )}
    >
      {/* Image — compact 3:2 ratio */}
      <div className="relative aspect-[3/2] bg-gray-50 flex items-center justify-center overflow-hidden">
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
            <span className="text-[9px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full border border-red-200">
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
                ? "text-amber-700 bg-amber-50 border-amber-200"
                : "text-gray-500 bg-white/80 border-gray-200"
            )}>
              {stock}
            </span>
          </div>
        )}
      </div>

      {/* Info — compact with code */}
      <div className="px-1.5 py-1 flex-1 flex flex-col min-h-[40px]">
        <p className="text-[11px] font-medium text-gray-800 line-clamp-2 leading-tight flex-1">
          {product.name}
        </p>
        <div className="flex items-center justify-between mt-0.5 gap-1">
          <p className="text-[11px] font-bold text-blue-600">
            {formatCurrency(product.sellPrice ?? 0)}
          </p>
          {product.code && (
            <p className="text-[8px] text-gray-400 font-mono truncate max-w-[60px]">
              {product.code}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
