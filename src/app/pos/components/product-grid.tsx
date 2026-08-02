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
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Product, ProductCategory } from "@/lib/types";
import { getProducts } from "@/lib/services/supabase/products";
import { getCategoriesByScope } from "@/lib/services/supabase/categories";
import {
  getPosStockSnapshot,
  type PosStockSnapshot,
  type PosStockRequest,
} from "@/lib/services/supabase/pos-stock";
import { getClient } from "@/lib/services/supabase/base";
import { useAuth } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { mapWithConcurrency } from "@/lib/utils/async-concurrency";
import {
  POS_STOCK_CHANNEL,
  POS_STOCK_EVENT,
  type PosStockChangedMessage,
} from "../lib/stock-events";
import { buildTrackedStockRefreshKey } from "../lib/stock-freshness";

type TrackedPosStockRequest = PosStockRequest & { lineId?: string };

interface ProductGridProps {
  searchQuery: string;
  /** CEO 08/07: truyền kèm khả dụng THẬT (BOM-aware) mà lưới đã tính → giỏ tô
   *  đỏ ô số lượng đúng cho hàng hết (kể cả SKU công thức mà NVL cũng hết). */
  onAddProduct: (product: Product, availableStock?: number) => void;
  onStockSnapshot?: (snapshot: PosStockSnapshot) => void;
  trackedStockRequests?: TrackedPosStockRequest[];
}

const STOCK_REFRESH_INTERVAL_MS = 10_000;

/** CEO 03/06/2026 — Sprint 3 (G3): SKU has_bom tại branch production tính
 *  khả dụng = min(NVL stock / qty BOM). Lưu Map để map sang tile. */
interface BomAvailMap {
  [skuId: string]: {
    available: number;
    bottleneckName?: string;
  };
}

export function ProductGrid({
  searchQuery,
  onAddProduct,
  onStockSnapshot,
  trackedStockRequests = [],
}: ProductGridProps) {
  const { currentBranch } = useAuth();
  const branchId = currentBranch?.id ?? "";
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [products, setProducts] = useState<Product[]>([]);
  const [bomAvail, setBomAvail] = useState<BomAvailMap>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [stockRefreshFailed, setStockRefreshFailed] = useState(false);
  const [totalProducts, setTotalProducts] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productsRef = useRef<Product[]>([]);
  const fetchIdRef = useRef(0);
  const stockRefreshInFlightRef = useRef(false);
  const stockRefreshPendingRef = useRef(false);
  const trackedStockRequestsRef = useRef<TrackedPosStockRequest[]>([]);
  const trackedStockKey = useMemo(
    () => buildTrackedStockRefreshKey(trackedStockRequests),
    [trackedStockRequests],
  );

  useEffect(() => {
    trackedStockRequestsRef.current = trackedStockRequests;
  }, [trackedStockRequests]);

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
      const fetchId = ++fetchIdRef.current;
      if (!branchId) {
        productsRef.current = [];
        setProducts([]);
        setBomAvail({});
        setTotalProducts(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadFailed(false);
      try {
        const filters: Record<string, string | string[]> = {
          status: "active",
          channel: "retail",
          productType: "sku",
        };
        if (catId !== "all") filters.category = catId;
        const query = {
          pageSize: 500,
          search: search || undefined,
          sortBy: "name" as const,
          sortOrder: "asc" as const,
          filters,
        };
        const firstPage = await getProducts({ ...query, page: 0 });
        const pageCount = Math.ceil(firstPage.total / query.pageSize);
        const remainingPageNumbers = Array.from(
          { length: Math.max(0, pageCount - 1) },
          (_, index) => index + 1,
        );
        const remainingPages = await mapWithConcurrency(
          remainingPageNumbers,
          4,
          (page) => getProducts({ ...query, page }),
        );
        const catalogProducts = [
          ...firstPage.data,
          ...remainingPages.flatMap((page) => page.data),
        ];
        // Keep the full retail catalog visible; overlay branch/BOM availability.
        const snapshot = await getPosStockSnapshot(
          [
            ...catalogProducts.map((product) => ({
              productId: product.id,
              hasBom: Boolean(product.hasBom),
            })),
            ...trackedStockRequestsRef.current,
          ],
          branchId,
        );
        const nextBomAvail: BomAvailMap = {};
        for (const entry of snapshot.values()) {
          if (entry.source !== "bom") continue;
          nextBomAvail[entry.productId] = {
            available: entry.availableStock,
            bottleneckName: entry.bottleneckMaterialName,
          };
        }
        const effectiveProducts = catalogProducts.map((product) => ({
          ...product,
          stock: snapshot.get(product.id)?.availableStock ?? 0,
        }));
        if (fetchId !== fetchIdRef.current) return;
        productsRef.current = effectiveProducts;
        setProducts(effectiveProducts);
        setTotalProducts(firstPage.total);
        setBomAvail(nextBomAvail);
        setStockRefreshFailed(false);
        onStockSnapshot?.(snapshot);
      } catch (error) {
        if (fetchId !== fetchIdRef.current) return;
        console.error("[POS] product grid load failed:", error);
        setLoadFailed(true);
        productsRef.current = [];
        setProducts([]);
      } finally {
        if (fetchId === fetchIdRef.current) setLoading(false);
      }
    },
    [branchId, onStockSnapshot],
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

  const refreshStocks = useCallback(async () => {
    if (!branchId) return;
    if (stockRefreshInFlightRef.current) {
      stockRefreshPendingRef.current = true;
      return;
    }
    const currentProducts = productsRef.current;
    if (
      currentProducts.length === 0 &&
      trackedStockRequestsRef.current.length === 0
    ) {
      return;
    }

    stockRefreshInFlightRef.current = true;
    try {
      const snapshot = await getPosStockSnapshot(
        [
          ...currentProducts.map((product) => ({
            productId: product.id,
            hasBom: Boolean(product.hasBom),
          })),
          ...trackedStockRequestsRef.current,
        ],
        branchId,
      );
      setProducts((current) => {
        const next = current.map((product) => {
          const entry = snapshot.get(product.id);
          return entry
            ? { ...product, stock: entry.availableStock }
            : product;
        });
        productsRef.current = next;
        return next;
      });

      const nextBomAvail: BomAvailMap = {};
      for (const entry of snapshot.values()) {
        if (entry.source !== "bom") continue;
        nextBomAvail[entry.productId] = {
          available: entry.availableStock,
          bottleneckName: entry.bottleneckMaterialName,
        };
      }
      setBomAvail(nextBomAvail);
      setStockRefreshFailed(false);
      onStockSnapshot?.(snapshot);
    } catch (error) {
      console.warn("[POS] refresh stock snapshot failed:", error);
      setStockRefreshFailed(true);
    } finally {
      stockRefreshInFlightRef.current = false;
      if (stockRefreshPendingRef.current) {
        stockRefreshPendingRef.current = false;
        queueMicrotask(() => void refreshStocks());
      }
    }
  }, [branchId, onStockSnapshot]);

  useEffect(() => {
    if (trackedStockKey) void refreshStocks();
  }, [trackedStockKey, refreshStocks]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshStocks();
    };
    const interval = window.setInterval(
      refreshWhenVisible,
      STOCK_REFRESH_INTERVAL_MS,
    );
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    window.addEventListener(POS_STOCK_EVENT, refreshWhenVisible);
    window.addEventListener("fnb-sync-complete", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      window.removeEventListener(POS_STOCK_EVENT, refreshWhenVisible);
      window.removeEventListener("fnb-sync-complete", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshStocks]);

  useEffect(() => {
    if (!branchId) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void refreshStocks(), 250);
    };

    const realtimeChannel = getClient()
      .channel(`pos-stock-${branchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "branch_stock",
          filter: `branch_id=eq.${branchId}`,
        },
        scheduleRefresh,
      )
      .subscribe();

    const broadcast =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(POS_STOCK_CHANNEL)
        : null;
    if (broadcast) {
      broadcast.onmessage = (event: MessageEvent<PosStockChangedMessage>) => {
        if (
          event.data?.type === "stock-changed" &&
          event.data.branchId === branchId
        ) {
          scheduleRefresh();
        }
      };
    }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      broadcast?.close();
      void getClient().removeChannel(realtimeChannel);
    };
  }, [branchId, refreshStocks]);
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
        {stockRefreshFailed && !loadFailed && (
          <div
            role="alert"
            className="mb-2 flex items-center gap-2 border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-foreground"
          >
            <Icon name="sync_problem" size={16} className="shrink-0 text-status-warning" />
            <span className="min-w-0 flex-1">
              Chưa cập nhật được tồn kho mới nhất. Kiểm tra mạng trước khi bán.
            </span>
            <button
              type="button"
              className="shrink-0 font-semibold text-primary hover:underline"
              onClick={() => void refreshStocks()}
            >
              Thử lại
            </button>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Icon name="progress_activity" className="animate-spin text-primary" />
          </div>
        ) : loadFailed ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
            <Icon name="cloud_off" size={40} className="opacity-60" />
            <p className="text-sm font-medium text-foreground">
              Không tải được sản phẩm và tồn kho
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary hover:bg-primary/90"
              onClick={() => void fetchProducts(selectedCategory, searchQuery)}
            >
              <Icon name="refresh" size={14} />
              Thử lại
            </button>
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
                onClick={(avail) => onAddProduct(product, avail)}
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
  /** CEO 08/07: nhận khả dụng THẬT (BOM-aware) để giỏ tô đỏ đúng khi hết. */
  onClick: (availableStock: number) => void;
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
      onClick={() => onClick(stock)}
      title={
        useBomAvail && bomBottleneckName
          ? `${product.name}\nKhả dụng tính từ NVL "${bomBottleneckName}"`
          : product.name
      }
      // CEO 08/07 (lần 2): KHÔNG tô nền/viền đỏ cả ô — rối mắt khi nhiều hàng hết.
      // Chip "Hết" đỏ đặc là đủ tín hiệu; ô giữ nền trắng bình thường, vẫn bấm được.
      className="flex items-center gap-2 bg-white rounded-lg border border-border p-2 text-left transition-all press-scale-sm min-h-[60px] hover:border-primary hover:shadow-sm"
      style={{ contentVisibility: "auto", containIntrinsicSize: "60px" }}
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
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-status-error text-white shrink-0">
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
              {useBomAvail ? `Còn ~${formatNumber(stock)}` : `Còn ${formatNumber(stock)}`}
            </span>
          ) : useBomAvail ? (
            // Production branch + SKU has_bom: show "Khả dụng từ NVL" badge
            // (số lớn, không cần warning màu vàng)
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
              ≈ {formatNumber(stock)}
            </span>
          ) : product.code ? (
            // CEO 06/06/2026 audit typography P0 #2: bỏ truncate max-w-[64px]
            // — cashier mua nhầm SKU vì mã dài "SP-001234567" cắt còn "SP-0012...".
            // Đổi sang min-w-0 + tooltip title đầy đủ + text-[10px] (tăng từ 9px).
            <p
              className="text-[10px] text-muted-foreground/70 font-mono min-w-0 break-all line-clamp-2"
              title={product.code}
            >
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
