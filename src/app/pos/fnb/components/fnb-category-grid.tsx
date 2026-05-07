"use client";

/**
 * FnbCategoryGrid — Mobile category picker grid 4-col (Sprint B — CEO 06/05).
 *
 * CEO feedback: "Mobile danh mục cũng nên có cách thiết kế khác, mobile kéo
 * kéo sẽ bất tiện. Phục vụ sẽ rất cần việc bấm bill trên điện thoại thật tốt".
 *
 * Thay cho horizontal scroll pills (FnbCategoryTabs cũ trên mobile). Layout:
 *   - Grid 4 cột × 2 hàng visible (8 categories) → đa số quán cafe ≤ 8 danh mục
 *   - Mỗi tile 56px height: icon trên + label dưới + count badge
 *   - Container max-h-[136px] + overflow-y-auto → quán nhiều cat (>8) scroll DỌC
 *     thay vì kéo ngang (đúng yêu cầu CEO)
 *
 * Active highlight: bg-primary text-on-primary giống category-sidebar để
 * staff đổi giữa mobile/tablet/desktop không bị "lost mental model".
 */

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import type { FnbCategoryWithCount } from "./fnb-category-sidebar";

/** Cùng map icon với fnb-category-sidebar — giữ DRY thì re-export. Fallback "local_cafe". */
function getCategoryIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("cà phê") || n.includes("ca phe") || n.includes("coffee")) return "local_cafe";
  if (n.includes("trà sữa") || n.includes("tra sua") || n.includes("bubble")) return "bubble_chart";
  if (n.includes("trà") || n.includes("tra") || n.includes("tea")) return "emoji_food_beverage";
  if (n.includes("sữa") || n.includes("sua") || n.includes("milk")) return "icecream";
  if (n.includes("nước") || n.includes("nuoc") || n.includes("juice")) return "local_drink";
  if (n.includes("đá xay") || n.includes("smoothie") || n.includes("frappe")) return "blender";
  if (n.includes("bánh") || n.includes("banh") || n.includes("cake") || n.includes("bakery"))
    return "bakery_dining";
  if (n.includes("topping") || n.includes("thêm") || n.includes("them")) return "add_circle";
  if (n.includes("set") || n.includes("combo") || n.includes("ăn") || n.includes("an"))
    return "lunch_dining";
  if (n.includes("km") || n.includes("khuyến mãi") || n.includes("khuyen mai"))
    return "local_offer";
  return "local_cafe";
}

interface FnbCategoryGridProps {
  categories: FnbCategoryWithCount[];
  totalCount: number;
  activeCategoryId: string | null;
  onSelect: (categoryId: string | null) => void;
}

export function FnbCategoryGrid({
  categories,
  totalCount,
  activeCategoryId,
  onSelect,
}: FnbCategoryGridProps) {
  // FIX (CEO 07/05): KHÔNG return null khi rỗng — vẫn render "Tất cả" để
  // CEO thấy layout shell. Empty tenant chưa add SP/danh mục.
  return (
    <div
      className="grid grid-cols-4 gap-1.5 p-2 bg-surface-container-lowest border-b border-outline-variant/20 max-h-[140px] overflow-y-auto shrink-0"
      role="tablist"
      aria-label="Danh mục"
    >
      {/* "Tất cả" — first tile */}
      <CategoryTile
        icon="apps"
        label="Tất cả"
        count={totalCount}
        active={activeCategoryId === null}
        onClick={() => onSelect(null)}
      />

      {categories.map((cat) => (
        <CategoryTile
          key={cat.id}
          icon={getCategoryIcon(cat.name)}
          label={cat.name}
          count={cat.count}
          active={activeCategoryId === cat.id}
          onClick={() => onSelect(cat.id)}
        />
      ))}
    </div>
  );
}

function CategoryTile({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: string;
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
        "relative flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[11px] transition-colors press-scale-sm min-h-[56px]",
        active
          ? "bg-primary text-on-primary font-bold ambient-shadow"
          : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-foreground",
      )}
      title={label}
    >
      <Icon
        name={icon}
        size={20}
        className={cn(
          "shrink-0",
          active ? "text-on-primary" : "text-on-surface-variant",
        )}
      />
      <span className="w-full px-1 truncate font-medium leading-tight text-center">
        {label}
      </span>
      <span
        className={cn(
          "absolute top-1 right-1 rounded-md px-1 py-0 text-[9px] font-semibold tabular-nums leading-tight",
          active
            ? "bg-on-primary/20 text-on-primary"
            : "bg-surface-container text-on-surface-variant",
        )}
      >
        {count}
      </span>
    </button>
  );
}
