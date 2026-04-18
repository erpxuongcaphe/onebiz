"use client";

/**
 * FnbCategoryTabs — Horizontal scrollable category pills for F&B menu
 *
 * "Tất cả" is always first. Active category gets primary styling.
 */

import { useRef } from "react";
import { cn } from "@/lib/utils";

export interface FnbCategory {
  id: string;
  name: string;
  code: string;
}

interface FnbCategoryTabsProps {
  categories: FnbCategory[];
  activeCategoryId: string | null;
  onSelect: (categoryId: string | null) => void;
}

export function FnbCategoryTabs({
  categories,
  activeCategoryId,
  onSelect,
}: FnbCategoryTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stitch FnB POS spec: tabs full `px-6 py-3 rounded-lg` (không phải pill tròn),
  // active `bg-primary text-on-primary shadow-sm`, inactive `bg-surface-container-low`.
  return (
    <div
      ref={scrollRef}
      className="flex gap-2 px-3 sm:px-4 py-2.5 overflow-x-auto no-scrollbar border-b border-outline-variant/20 bg-surface-container-lowest shrink-0"
    >
      {/* "Tất cả" — always first */}
      <CategoryPill
        label="Tất cả"
        active={activeCategoryId === null}
        onClick={() => onSelect(null)}
      />

      {categories.map((cat) => (
        <CategoryPill
          key={cat.id}
          label={cat.name}
          active={activeCategoryId === cat.id}
          onClick={() => onSelect(cat.id)}
        />
      ))}
    </div>
  );
}

function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap press-scale-sm",
        active
          ? "bg-primary text-on-primary ambient-shadow"
          : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}
