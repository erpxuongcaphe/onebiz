"use client";
import { useRef, useState, useEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";

export interface FnbProduct {
  id: string;
  name: string;
  code: string;
  sell_price: number;
  image_url?: string;
  stock: number;
  category_id: string | null;
  /** Sprint UI-4: dùng cho sub-category pills (group by brand). Null nếu chưa gán. */
  brand?: string | null;
  /** Explicitly allows this direct-sale FnB SKU to be sold at 0d. */
  allow_free_sale?: boolean;
}

interface FnbProductGridProps {
  products: FnbProduct[];
  displayMode?: "compact" | "photos";
  onSelectProduct: (product: FnbProduct) => void;
  /**
   * Có hiển thị overlay "Hết hàng" khi stock<=0 hay không.
   * FnB: SP làm theo đơn, stock không phản ánh khả năng bán → default FALSE.
   * Nếu tenant thực sự track stock NVL qua BOM thì bật lên.
   */
  enforceStock?: boolean;
  /**
   * Map productId → tổng số lượng đang trong giỏ. Khi >0 sẽ render
   * badge nhỏ ở góc tile để cashier thấy ngay món nào đã chọn bao
   * nhiêu (KiotViet/Toast pattern). Optional — không truyền thì
   * không hiện gì.
   */
  cartQtyByProductId?: Record<string, number>;
}

// Row heights include the bottom gap and drive both virtualizer and rendered rows.
// Compact mode prioritizes names/prices; photo mode retains the taller image cards.
const COMPACT_CARD_HEIGHT = 112;
const PHOTO_CARD_HEIGHT = 170;
const GRID_GAP = 12; // px — tương ứng gap-3 Tailwind
const ROW_PADDING = 12; // px — p-3 wrapper
// Menu container widths, after subtracting category sidebar and cart.
const COLS_BREAKPOINTS = [
  { minWidth: 1080, cols: 6 },
  { minWidth: 820, cols: 5 },
  { minWidth: 620, cols: 4 },
  { minWidth: 460, cols: 3 },
  { minWidth: 0, cols: 2 },
] as const;

export function getColsForWidth(width: number): number {
  for (const bp of COLS_BREAKPOINTS) {
    if (width >= bp.minWidth) return bp.cols;
  }
  return 2;
}

export function FnbProductGrid({
  products,
  displayMode = "compact",
  onSelectProduct,
  enforceStock = false,
  cartQtyByProductId,
}: FnbProductGridProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const hasProducts = products.length > 0;

  // ResizeObserver — track parent width để tính số cột động theo viewport.
  // Lý do không dùng CSS grid responsive thuần: virtualizer cần biết cols fixed
  // để chia products thành rows (index tuyệt đối).
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasProducts]);

  const cols = containerWidth > 0 ? getColsForWidth(containerWidth) : 2;
  const rows = useMemo(
    () => Math.ceil(products.length / cols),
    [products.length, cols],
  );

  const cardHeight = displayMode === "photos" ? PHOTO_CARD_HEIGHT : COMPACT_CARD_HEIGHT;
  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    // The same row step includes its bottom gap in both display modes.
    estimateSize: () => cardHeight,
    overscan: 3, // render trước/sau 3 hàng để scroll mượt
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [cardHeight, cols, rowVirtualizer]);

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
        <Icon name="local_cafe" size={40} className="mb-3" />
        <p className="text-sm">Không có sản phẩm nào</p>
      </div>
    );
  }

  // Virtualized grid: render chỉ visible rows → DOM nodes ~ cols × (rowsVisible + overscan)
  // Vd 500 SP × 5 col = 100 rows, viewport 4 rows visible → render 7 rows × 5 = 35 cards
  // thay vì 500 cards. Giảm DOM 93%, RAM 70%, first paint gần instant.
  return (
    <div
      ref={parentRef}
      className="overflow-auto h-full"
      style={{ paddingLeft: ROW_PADDING, paddingRight: ROW_PADDING, paddingTop: ROW_PADDING }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const rowIdx = virtualRow.index;
          const rowProducts = products.slice(rowIdx * cols, (rowIdx + 1) * cols);
          return (
            <div
              key={virtualRow.key}
              className="grid"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${cardHeight}px`,
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gap: `${GRID_GAP}px`,
                paddingBottom: `${GRID_GAP}px`,
              }}
            >
              {rowProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  compact={displayMode === "compact"}
                  onClick={() => onSelectProduct(product)}
                  enforceStock={enforceStock}
                  cartQty={cartQtyByProductId?.[product.id] ?? 0}
                />
              ))}
              {/* Fill empty slots để giữ grid alignment khi row cuối thiếu */}
              {rowProducts.length < cols &&
                Array.from({ length: cols - rowProducts.length }).map((_, i) => (
                  <div key={`empty-${i}`} aria-hidden />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProductCard({
  product,
  compact,
  onClick,
  enforceStock,
  cartQty,
}: {
  product: FnbProduct;
  compact: boolean;
  onClick: () => void;
  enforceStock: boolean;
  cartQty: number;
}) {
  // Chỉ coi "Hết hàng" khi enforceStock=true. POS FnB default FALSE vì SP
  // được làm theo đơn (nguyên liệu track ở NVL, không ở SP bán).
  // Trước đây mặc định hiển thị overlay → CEO báo "hết hàng mờ căm không thấy gì"
  // do stock=0 toàn bộ SP FnB.
  const outOfStock = enforceStock && product.stock <= 0;
  // CEO 22/05/2026: rollback POS guard — cho phép bán SP giá 0đ tự do
  // (KM, tặng kèm, miễn phí intentional). Cashier tự chịu trách nhiệm.
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  return (
    <button type="button" onClick={onClick} disabled={outOfStock}
      aria-label={product.name + ", " + formatCurrency(product.sell_price) + "đ"}
      className={cn(
        "group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-white text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:bg-card",
        cartQty > 0 ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/40",
        compact ? "justify-between p-3" : "",
        outOfStock && "opacity-50",
      )}>
      {!compact && (
        <div className="relative min-h-0 flex-1 overflow-hidden p-2">
          {product.image_url && !imageError ? (
            <>
              {!imageLoaded && <Skeleton className="absolute inset-2 rounded-lg" />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.image_url} alt="" loading="lazy"
                className={cn("h-full w-full rounded-lg object-cover", !imageLoaded && "opacity-0")}
                onLoad={() => setImageLoaded(true)}
                onError={() => { setImageError(true); setImageLoaded(true); }} />
            </>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg bg-muted/40">
              <Icon name="local_cafe" size={24} className="text-muted-foreground/50" />
            </div>
          )}
        </div>
      )}
      <div className={cn("flex min-w-0 flex-col gap-2", !compact && "flex-shrink-0 px-3 pb-3 pt-1")}>
        <h3 className="line-clamp-2 min-h-[2.5em] text-sm font-semibold leading-tight text-foreground">{product.name}</h3>
        <div className="flex items-center justify-between gap-1">
          <span className="whitespace-nowrap text-sm font-bold tabular-nums text-foreground">{formatCurrency(product.sell_price)}đ</span>
          {cartQty > 0 && (
            <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-primary px-1 text-xs font-bold tabular-nums text-primary-foreground" aria-label={"Đã thêm " + cartQty + " vào giỏ"}>{cartQty}</span>
          )}
          {enforceStock && cartQty === 0 && <span className="whitespace-nowrap text-[11px] text-muted-foreground">{outOfStock ? "Hết hàng" : "Sẵn sàng"}</span>}
        </div>
      </div>
      {outOfStock && !compact && <Badge variant="destructive" className="absolute left-3 top-3">Hết hàng</Badge>}
    </button>
  );
}
