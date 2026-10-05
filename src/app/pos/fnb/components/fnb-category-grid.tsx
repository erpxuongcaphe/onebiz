"use client";

/** Mobile category picker: expand the vertical grid when needed, then return
 * space to the menu after choosing. The current category remains visible. */

import { useState } from "react";
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
  const [expanded, setExpanded] = useState(false);
  const activeName = categories.find((category) => category.id === activeCategoryId)?.name ?? "Tất cả";
  const selectCategory = (id: string | null) => { onSelect(id); setExpanded(false); };
  // FIX (CEO 07/05): KHÔNG return null khi rỗng — vẫn render "Tất cả" để
  // CEO thấy layout shell. Empty tenant chưa add SP/danh mục.
  return (
    <div className="shrink-0 border-b border-border bg-white dark:bg-card">
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="fnb-mobile-categories" className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-sm">
        <span className="flex min-w-0 items-center gap-2"><Icon name="category" size={18} /><span className="truncate font-semibold">{activeName}</span></span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">Danh mục<Icon name={expanded ? "expand_less" : "expand_more"} size={18} /></span>
      </button>
      {expanded && <div id="fnb-mobile-categories"
      className="grid grid-cols-4 gap-1.5 p-2 bg-surface-container-lowest border-b border-outline-variant/20 max-h-[240px] overflow-y-auto shrink-0"
      role="group"
      aria-label="Danh mục"
    >
      {/* "Tất cả" — first tile */}
      <CategoryTile
        icon="apps"
        label="Tất cả"
        count={totalCount}
        active={activeCategoryId === null}
        onClick={() => selectCategory(null)}
      />

      {categories.map((cat) => (
        <CategoryTile
          key={cat.id}
          icon={getCategoryIcon(cat.name)}
          label={cat.name}
          count={cat.count}
          active={activeCategoryId === cat.id}
          onClick={() => selectCategory(cat.id)}
        />
      ))}
      </div>}
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
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[11px] transition-colors press-scale-sm min-h-[64px]",
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
      <span className="w-full px-1 line-clamp-2 font-medium leading-tight text-center">
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
