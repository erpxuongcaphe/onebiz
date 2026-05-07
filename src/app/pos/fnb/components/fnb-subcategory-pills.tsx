"use client";

/**
 * FnbSubcategoryPills — Pills row dưới header / trên menu grid (Sprint UI-4).
 *
 * Mockup v3 desktop: khi user chọn 1 category cha (vd "Cà phê"), hiển thị
 * pills row gom theo `brand` của products trong category đó:
 *   "Tất cả (24) · Highlands (6) · Phúc Long (8) · Trung Nguyên (4) ..."
 *
 * Tự ẩn khi:
 *   - activeCategory == null (đang xem "Tất cả" → không có nhóm)
 *   - không SP nào trong category có brand (toàn null) → 1 pill "Tất cả"
 *     không có giá trị filter, ẩn để gọn UI
 *
 * Khi đã có ≥1 brand → hiện row với pill "Tất cả" + 1 pill mỗi brand.
 * Pill click → setActiveSubFilter(brand). null = "Tất cả" (clear filter).
 *
 * Future: thay thế bằng `categories.parent_id` hierarchy khi DB seed
 * sub-categories (vd Cà phê → Đen, Sữa, Cold brew, Espresso...).
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { FnbProduct } from "./fnb-product-grid";

interface FnbSubcategoryPillsProps {
  /** Tên category cha đang chọn (null = "Tất cả" → ẩn pills). */
  activeCategoryName: string | null;
  /** Products trong active category (đã filter). */
  productsInCategory: FnbProduct[];
  /** Mapping productId → brand (lookup từ tenant data tổng). Sprint sau pass FnbProduct kèm brand. */
  brandByProductId?: Map<string, string | null>;
  /** Brand đang filter sâu hơn — null = không filter, hiện tất cả của category. */
  activeSubFilter: string | null;
  onSelectSubFilter: (brand: string | null) => void;
}

export function FnbSubcategoryPills({
  activeCategoryName,
  productsInCategory,
  brandByProductId,
  activeSubFilter,
  onSelectSubFilter,
}: FnbSubcategoryPillsProps) {
  // Compute brand → count map từ products + lookup
  const brandStats = useMemo(() => {
    if (!brandByProductId) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const p of productsInCategory) {
      const b = brandByProductId.get(p.id);
      if (b && b.trim()) {
        map.set(b, (map.get(b) ?? 0) + 1);
      }
    }
    return map;
  }, [productsInCategory, brandByProductId]);

  // Hide nếu không có active category HOẶC không SP nào có brand
  if (!activeCategoryName) return null;
  if (brandStats.size === 0) return null;

  const totalCount = productsInCategory.length;
  const brands = Array.from(brandStats.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], "vi"),
  );

  return (
    <div
      className="bg-surface-container-lowest border-b border-outline-variant/20 px-3 py-2 flex items-center gap-1.5 flex-wrap shrink-0"
      role="tablist"
      aria-label={`Phân loại trong ${activeCategoryName}`}
    >
      <span className="text-[11px] uppercase tracking-wider font-bold text-on-surface-variant mr-1 shrink-0">
        {activeCategoryName}
      </span>
      <Pill
        label="Tất cả"
        count={totalCount}
        active={activeSubFilter === null}
        onClick={() => onSelectSubFilter(null)}
      />
      {brands.map(([brand, count]) => (
        <Pill
          key={brand}
          label={brand}
          count={count}
          active={activeSubFilter === brand}
          onClick={() => onSelectSubFilter(brand)}
        />
      ))}
    </div>
  );
}

function Pill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors press-scale-sm shrink-0",
        active
          ? "bg-surface text-primary ambient-shadow border border-primary/20"
          : "bg-transparent text-on-surface-variant hover:bg-surface-container hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "tabular-nums opacity-70",
          active ? "text-primary" : "text-on-surface-variant",
        )}
      >
        ({count})
      </span>
    </button>
  );
}
