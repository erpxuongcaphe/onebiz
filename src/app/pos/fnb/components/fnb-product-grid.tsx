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
}

interface FnbProductGridProps {
  products: FnbProduct[];
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

// Grid config — responsive column count + fixed row height cho virtualizer.
// Row height = card image (aspect-square) + name/status block + padding.
// Card width tính theo cols; card height cố định 220px để virtualizer không cần
// measure (fast path, zero layout thrash).
const CARD_HEIGHT = 220; // px — aspect-square image ~ 160px + padding + 2 dòng text
const GRID_GAP = 12; // px — tương ứng gap-3 Tailwind
const ROW_PADDING = 12; // px — p-3 wrapper
// Container width breakpoints (KHÔNG phải viewport — đã tính cart width).
// iPad portrait 768px - cart 280px = 488px container → 3 cols.
// iPad landscape 1024px - cart 340px = 684px container → 4 cols.
// Desktop 1440px - cart 360px = 1080px container → 5 cols.
// Responsive Sprint B1 (CEO 25/05/2026): giảm breakpoint 720→680 vì
// iPad landscape có container 684px (24-1024 - cart 340) bị fall xuống
// 3 cols thay vì 4. Bây giờ 680+ = 4 cols → iPad landscape OK.
const COLS_BREAKPOINTS = [
  { minWidth: 1280, cols: 6 }, // 1080+ container: 6 cột
  { minWidth: 1024, cols: 5 }, // 850+: 5 cột
  { minWidth: 680, cols: 4 },  // 680+: 4 cột (iPad landscape với cart)
  { minWidth: 480, cols: 3 },  // 480+: 3 cột (iPad portrait với cart)
  { minWidth: 320, cols: 2 },  // mobile: 2 cột
  { minWidth: 0, cols: 1 },    // very narrow: 1 cột
] as const;

function getColsForWidth(width: number): number {
  for (const bp of COLS_BREAKPOINTS) {
    if (width >= bp.minWidth) return bp.cols;
  }
  return 2;
}

export function FnbProductGrid({
  products,
  onSelectProduct,
  enforceStock = false,
  cartQtyByProductId,
}: FnbProductGridProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

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
  }, []);

  const cols = containerWidth > 0 ? getColsForWidth(containerWidth) : 2;
  const rows = useMemo(
    () => Math.ceil(products.length / cols),
    [products.length, cols],
  );

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + GRID_GAP,
    overscan: 3, // render trước/sau 3 hàng để scroll mượt
  });

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
                height: `${CARD_HEIGHT}px`,
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
  onClick,
  enforceStock,
  cartQty,
}: {
  product: FnbProduct;
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
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col bg-surface-container-low rounded-xl overflow-hidden press-scale-sm transition-all duration-200 text-left h-full",
        // Sprint POS-FNB-1: dùng ambient-shadow-elevated cho hover (tier 2)
        // → depth rõ hơn, card "nổi" lên khi hover, đúng pattern Stitch.
        "hover:bg-surface-container-lowest hover:ambient-shadow-elevated border border-transparent hover:border-outline-variant/20",
        outOfStock && "opacity-50 pointer-events-none",
      )}
    >
      {/* Image area — aspect-square với padding Stitch style */}
      <div className="aspect-square overflow-hidden relative p-2 flex-shrink-0">
        {product.image_url && !imageError ? (
          <>
            {!imageLoaded && (
              <Skeleton className="absolute inset-2 rounded-lg" />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image_url}
              alt={product.name}
              className={cn(
                "h-full w-full object-cover rounded-lg group-hover:scale-105 transition-transform duration-500",
                !imageLoaded && "opacity-0",
              )}
              loading="lazy"
              onLoad={() => setImageLoaded(true)}
              onError={() => {
                setImageError(true);
                setImageLoaded(true);
              }}
            />
          </>
        ) : (
          <div className="h-full w-full rounded-lg bg-primary-fixed/40 flex items-center justify-center">
            <Icon name="local_cafe" size={32} className="text-primary/60" />
          </div>
        )}

        {/* Price badge — Stitch glass style top-right */}
        <div className="absolute top-3 right-3 bg-primary/90 backdrop-blur-[20px] text-on-primary text-[11px] font-bold px-3 py-1 rounded-full ambient-shadow">
          {formatCurrency(product.sell_price)}
        </div>

        {/* Qty-in-cart badge — top-left khi món đã trong giỏ. Giúp
            cashier thấy ngay món nào đã chọn bao nhiêu (KiotViet/Toast
            pattern). Pure additive, không đổi flow. */}
        {cartQty > 0 && (
          <div
            className="absolute top-3 left-3 flex h-6 min-w-6 items-center justify-center rounded-full bg-status-success px-1.5 text-[11px] font-bold leading-none text-white ambient-shadow tabular-nums"
            aria-label={`Đã thêm ${cartQty} vào giỏ`}
          >
            {cartQty}
          </div>
        )}

        {/* Out of stock overlay */}
        {outOfStock && (
          <div className="absolute inset-2 bg-surface-container-lowest/60 backdrop-blur-sm rounded-lg flex items-center justify-center">
            <Badge variant="destructive" className="text-xs px-2 py-1 font-bold">
              Hết hàng
            </Badge>
          </div>
        )}
      </div>

      {/* Name + status */}
      <div className="px-3 pb-3 pt-1 flex-1 min-h-0">
        <h3 className="font-heading font-semibold text-sm text-foreground line-clamp-2 leading-tight mb-0.5">
          {product.name}
        </h3>
        {enforceStock && (
          <p className="text-[11px] text-muted-foreground">
            {outOfStock ? "Hết hàng" : "Sẵn sàng"}
          </p>
        )}
      </div>
    </button>
  );
}
