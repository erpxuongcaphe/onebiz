"use client";

/**
 * ProductGrid — KiotViet-style product browsing panel
 *
 * Top: horizontal scrollable category pills
 * Body: responsive tile grid (image + name + price)
 * Clicking a tile fires onAddProduct
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { Product, ProductCategory } from "@/lib/types";
import { getProducts } from "@/lib/services/supabase/products";
import { getCategoriesByScope } from "@/lib/services/supabase/categories";
import { getBomAvailabilityBatch } from "@/lib/services/supabase/bom";
import { useAuth } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";

interface ProductGridProps {
  searchQuery: string;
  onAddProduct: (product: Product) => void;
}

/** CEO 03/06/2026 — Sprint 3 (G3): SKU has_bom tại branch production tính
 *  khả dụng = min(NVL stock / qty BOM). Lưu Map để map sang tile. */
interface BomAvailMap {
  [skuId: string]: {
    available: number;
    bottleneckName?: string;
  };
}

export function ProductGrid({ searchQuery, onAddProduct }: ProductGridProps) {
  const { currentBranch } = useAuth();
  const branchId = currentBranch?.id ?? "";
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [products, setProducts] = useState<Product[]>([]);
  const [bomAvail, setBomAvail] = useState<BomAvailMap>({});
  const [loading, setLoading] = useState(true);
  const [totalProducts, setTotalProducts] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Fetch categories on mount ----
  // POS Retail chỉ hiện categories có ≥1 SP retail (CEO 04/05). Auto-compute
  // từ products.channel="retail" — không cần column channel ở categories.
  useEffect(() => {
    getCategoriesByScope("sku", "retail")
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
          // CEO 29/05/2026: KHÔNG giới hạn số SKU trên POS — nạp toàn bộ SP của
          // nhóm (lưới có tab nhóm + ô tìm để cashier điều hướng nhanh).
          pageSize: 100000,
          search: search || undefined,
          sortBy: "name",
          sortOrder: "asc",
          filters,
        });
        setProducts(result.data);
        setTotalProducts(result.total);

        // CEO 03/06/2026 — Sprint 3 (G3): cho SKU has_bom=true, tính khả dụng
        // theo BOM. Branch production sẽ trả số > 0, outlet trả empty (FE
        // fallback dùng product.stock). Batch 1 RPC, không spam.
        const skusWithBom = result.data
          .filter((p) => p.hasBom && p.productType === "sku")
          .map((p) => p.id);
        if (skusWithBom.length > 0 && branchId) {
          try {
            const map = await getBomAvailabilityBatch(skusWithBom, branchId);
            const next: BomAvailMap = {};
            for (const [skuId, entry] of map.entries()) {
              next[skuId] = {
                available: entry.available,
                bottleneckName: entry.bottleneckMaterialName,
              };
            }
            setBomAvail(next);
          } catch {
            // fail silent — fallback dùng product.stock
            setBomAvail({});
          }
        } else {
          setBomAvail({});
        }
      } catch {
        setProducts([]);
      } finally {
        setLoading(false);
      }
    },
    [branchId]
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

  // CEO 29/05/2026: KHÔNG ẩn SP giá bán = 0 nữa. Nhiều SKU (vd nhóm Bao bì)
  // chưa đặt giá bán vẫn cần hiện trên POS để bán / đặt giá tại quầy (bán 0đ
  // đã có popup xác nhận riêng). Trước đây lọc sellPrice>0 làm ẩn mất chúng.
  const displayProducts = products;

  return (
    <div className="flex flex-col md:flex-row h-full bg-surface-container-low">
      {/* ── Mobile: horizontal pills (giữ pattern cũ cho <md, cashier mobile
              quen tap pill ngang). Desktop: ẩn để dùng vertical sidebar. ── */}
      <div className="md:hidden flex items-center gap-2 px-3 py-2 overflow-x-auto border-b bg-white shrink-0 scrollbar-none">
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
      {/* Responsive Sprint B9 (CEO 25/05/2026): tăng min width 132→160px
          để label category đọc rõ trên laptop 13" 1280px (10vw=128px hit floor).
          Max 200px cho monitor lớn. */}
      <aside
        className="hidden md:flex flex-col border-r bg-white shrink-0 overflow-y-auto"
        style={{ width: "clamp(160px, 12vw, 200px)" }}
      >
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
          // CEO 22/05/2026 (UX P2 #5): Empty state có CTA setup SP khi
          // chưa có data. Cashier mới onboard biết bước tiếp theo phải làm.
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-muted-foreground gap-3 px-6 text-center">
            <Icon name="inventory_2" size={40} className="opacity-50" />
            {searchQuery ? (
              <p className="text-sm font-medium">
                Không tìm thấy sản phẩm khớp &quot;{searchQuery}&quot;
              </p>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">
                  Chưa có sản phẩm Retail nào
                </p>
                <p className="text-xs max-w-xs">
                  Vào trang Hàng hoá để tạo sản phẩm bán lẻ, sau đó quay lại đây.
                </p>
                <a
                  href="/hang-hoa"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 mt-1 bg-primary text-on-primary text-xs font-semibold rounded-lg hover:bg-primary/90 transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="add" size={14} />
                  Tạo sản phẩm Retail
                </a>
              </>
            )}
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
                bomAvailable={bomAvail[product.id]?.available}
                bomBottleneckName={bomAvail[product.id]?.bottleneckName}
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
        "group flex items-center justify-between gap-2 px-3 py-2 min-h-[40px] text-xs text-left transition-colors border-l-4 shrink-0",
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
        "shrink-0 px-3 py-1 rounded-full text-[11px] font-medium transition-all whitespace-nowrap",
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
//
// CEO 03/06/2026 — Sprint 3 (G3): SKU has_bom tại branch production có
// stock=0 nhưng thực tế bán được X đơn vị (tính từ NVL gốc). Prop
// `bomAvailable` cho phép override hiển thị "Còn X" + tooltip "Tính từ NVL".
function ProductTile({
  product,
  bomAvailable,
  bomBottleneckName,
  onClick,
}: {
  product: Product;
  bomAvailable?: number;
  bomBottleneckName?: string;
  onClick: () => void;
}) {
  // Use BOM availability nếu có (SKU has_bom tại branch production)
  // Fallback dùng product.stock như cũ.
  const useBomAvail = product.hasBom && typeof bomAvailable === "number";
  const stock = useBomAvail ? bomAvailable! : (product.stock ?? 0);
  const outOfStock = stock <= 0;
  const showStockChip = outOfStock || stock <= 5;
  // CEO 22/05/2026: rollback POS guard — cho phép bán SP giá 0đ tự do
  // (vì có thể là KM/free intentional). Cashier tự chịu trách nhiệm.

  return (
    <button
      type="button"
      onClick={onClick}
      title={
        useBomAvail && bomBottleneckName
          ? `${product.name}\nKhả dụng tính từ NVL "${bomBottleneckName}"`
          : product.name
      }
      className={cn(
        "flex items-center gap-2 bg-white rounded-lg border border-border p-2 text-left transition-all press-scale-sm min-h-[60px]",
        "hover:border-primary hover:shadow-sm",
        outOfStock && "opacity-60",
      )}
    >
      {/* Thumb 40×40 vuông — image hoặc placeholder neutral (xám nhạt + icon). */}
      <div className="relative h-10 w-10 shrink-0 rounded-lg bg-surface-container-low flex items-center justify-center overflow-hidden">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <Icon name="inventory_2" size={16} className="text-muted-foreground/40" />
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
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-status-error/10 text-status-error border border-status-error/20 shrink-0">
              Hết
            </span>
          ) : showStockChip ? (
            <span
              className={cn(
                "text-[9px] font-semibold px-2 py-0.5 rounded-full shrink-0",
                useBomAvail
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-status-warning/15 text-status-warning",
              )}
            >
              {useBomAvail ? `Còn ~${stock}` : `Còn ${stock}`}
            </span>
          ) : useBomAvail ? (
            // Production branch + SKU has_bom: show "Khả dụng từ NVL" badge
            // (số lớn, không cần warning màu vàng)
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
              ≈ {stock}
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
