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
// C2 (CEO 18/08): thu thẻ 220→170px để tăng mật độ. Khối chữ dưới CỐ ĐỊNH
// (tên 2 dòng + giá dòng riêng ≈ 64px), ảnh chiếm phần còn lại (min-h-0 co
// được). ⚠️ Đổi chiều cao thẻ PHẢI đổi hằng số này (bộ cuộn ảo tính vị trí
// hàng theo nó) — có test khoá fnb-c2-card-grid.test.ts.
const CARD_HEIGHT = 170; // px — ảnh co giãn (~90-100px) + tên 2 dòng + giá
const GRID_GAP = 12; // px — tương ứng gap-3 Tailwind
const ROW_PADDING = 12; // px — p-3 wrapper
// Container width breakpoints (KHÔNG phải viewport — đã trừ sidebar + giỏ).
// C2: hạ ngưỡng để desktop đạt 5-6 món/hàng. Sau C1: desktop 1536 → container
// 1536-220-440-24 ≈ 852 → 5 cột (ô ~161px); 1920 → ~1236 → 6 cột (ô ~194px);
// tablet ngang 1180 → ~546 → 3 cột; tablet dọc 820 (không giỏ) → ~660 → 4 cột;
// điện thoại 375 → ~351 → 2 cột. Ô hẹp nhất ~153px vẫn đủ tên 2 dòng + giá.
// Ngưỡng có DỰ PHÒNG ~30px cho thanh cuộn dọc (10-17px tuỳ máy) + sai số:
// đo preview 18/08 desktop 1536 → contentRect thật 842px (không phải 852 trên
// giấy) vì scrollbar ăn vào — ngưỡng 850 làm rơi oan xuống 4 cột.
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
      {/* Ảnh — 04/08: BỎ aspect-square + flex-shrink-0.
          Ô cao cứng 220px (CARD_HEIGHT) nhưng ảnh vuông lấy chiều cao = chiều
          rộng ô; ô rộng hơn ~170px là ảnh ăn hết 220px, khối tên bị đẩy ra
          ngoài rồi overflow-hidden cắt mất. Đo trên máy thật: ô kết thúc
          y=324 mà tên món nằm y=323–340 → thu ngân chỉ thấy cái cốc.
          Giờ ảnh co được (min-h-0), khối tên giữ chỗ cố định. */}
      <div className="relative min-h-0 flex-1 overflow-hidden p-2">
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

      {/* C2 — thứ tự CEO chốt: ảnh → tên → GIÁ → còn/hết. Giá bỏ badge đè
          ảnh, xuống dòng riêng dưới tên: luôn thấy, không bị che, không "...".
          flex-shrink-0 để khối chữ LUÔN có chỗ, không bị ảnh đẩy ra ngoài. */}
      <div className="flex-shrink-0 px-2.5 pb-2 pt-1">
        <h3 className="font-heading font-semibold text-[13px] text-foreground line-clamp-2 leading-tight min-h-[2.1em]">
          {product.name}
        </h3>
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-[13px] font-bold text-primary tabular-nums whitespace-nowrap">
            {formatCurrency(product.sell_price)}đ
          </span>
          {enforceStock && (
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {outOfStock ? "Hết hàng" : "Sẵn sàng"}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
