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

  return (
    <div
      ref={scrollRef}
      className="flex flex-wrap gap-2 sm:gap-1.5 px-3 py-2.5 sm:py-2 max-h-[88px] sm:max-h-[72px] overflow-y-auto border-b bg-white shrink-0"
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
        "shrink-0 px-4 py-2 sm:px-3 sm:py-1.5 rounded-full text-sm sm:text-xs font-medium transition-all whitespace-nowrap active:scale-95",
        active
          ? "bg-blue-600 text-white shadow-sm"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300"
      )}
    >
      {label}
    </button>
  );
}
