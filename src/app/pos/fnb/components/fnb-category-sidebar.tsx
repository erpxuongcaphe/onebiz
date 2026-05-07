"use client";

/**
 * FnbCategorySidebar — Vertical category navigation (Sprint A — CEO 06/05).
 *
 * Thay cho `FnbCategoryTabs` horizontal scroll. CEO feedback:
 * "Danh mục nên để qua cột trái cho dễ xem hơn" + "tablet thực đơn hãy kéo dọc".
 *
 * Width:
 *   - Desktop (≥1024px) → 200px (đủ cho icon + label dài "Trà sữa truyền thống")
 *   - Tablet (768-1023px) → 144px (gọn hơn để tận menu zone width)
 * Mobile (<768px) component KHÔNG render (parent tự fallback sang horizontal pills
 * hoặc grid — sẽ làm ở Sprint B).
 *
 * Stitch tokens: bg-surface-container-lowest · border-r outline-variant/20 ·
 * active item bg-primary-fixed text-primary · count badge bg-surface-container.
 */

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

export interface FnbCategoryWithCount {
  id: string;
  name: string;
  code: string;
  /** Số sản phẩm thuộc category — hiển thị badge bên phải. */
  count: number;
}

interface FnbCategorySidebarProps {
  categories: FnbCategoryWithCount[];
  /** Total products để hiển thị "Tất cả (N)". */
  totalCount: number;
  activeCategoryId: string | null;
  onSelect: (categoryId: string | null) => void;
  /** Compact mode: dùng cho tablet portrait/landscape (140px). */
  compact?: boolean;
}

/**
 * Map tên category VN → Material Symbol icon. Fallback "local_cafe".
 * Match bằng prefix lower-case. Mở rộng dần khi tenant tạo category mới.
 */
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

export function FnbCategorySidebar({
  categories,
  totalCount,
  activeCategoryId,
  onSelect,
  compact = false,
}: FnbCategorySidebarProps) {
  return (
    <aside
      className={cn(
        "shrink-0 bg-surface-container-lowest border-r border-outline-variant/20 flex flex-col overflow-hidden",
        compact ? "w-36" : "w-50",
      )}
      style={{ width: compact ? 144 : 200 }}
      aria-label="Danh mục"
    >
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {/* "Tất cả" — always first, sticky-ish UX để user dễ reset filter */}
        <CategoryButton
          icon="apps"
          label="Tất cả"
          count={totalCount}
          active={activeCategoryId === null}
          compact={compact}
          onClick={() => onSelect(null)}
        />

        {categories.map((cat) => (
          <CategoryButton
            key={cat.id}
            icon={getCategoryIcon(cat.name)}
            label={cat.name}
            count={cat.count}
            active={activeCategoryId === cat.id}
            compact={compact}
            onClick={() => onSelect(cat.id)}
          />
        ))}

        {categories.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            Chưa có danh mục
          </div>
        )}
      </div>
    </aside>
  );
}

function CategoryButton({
  icon,
  label,
  count,
  active,
  compact,
  onClick,
}: {
  icon: string;
  label: string;
  count: number;
  active: boolean;
  compact: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 rounded-lg text-left transition-colors press-scale-sm",
        compact ? "px-2 py-2 text-xs" : "px-3 py-2.5 text-sm",
        active
          ? "bg-primary-fixed text-primary font-bold ambient-shadow"
          : "text-on-surface-variant hover:bg-surface-container hover:text-foreground",
      )}
      title={label}
    >
      <Icon
        name={icon}
        size={compact ? 16 : 18}
        className={cn(
          "shrink-0",
          active ? "text-primary" : "text-on-surface-variant",
        )}
      />
      <span className="flex-1 min-w-0 truncate font-medium">{label}</span>
      <span
        className={cn(
          "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
          active
            ? "bg-primary text-on-primary"
            : "bg-surface-container text-on-surface-variant",
        )}
      >
        {count}
      </span>
    </button>
  );
}
