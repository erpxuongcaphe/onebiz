"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarCellProps {
  starred: boolean;
  onToggle: () => void;
}

/**
 * Star/Favorite cell for data table rows — KiotViet style.
 */
export function StarCell({ starred, onToggle }: StarCellProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="p-0.5 hover:scale-110 transition-transform"
      title={starred ? "Bỏ đánh dấu" : "Đánh dấu"}
    >
      <Star
        className={cn(
          "h-4 w-4 transition-colors",
          starred
            ? "fill-amber-400 text-amber-400"
            : "fill-none text-muted-foreground/40 hover:text-amber-400"
        )}
      />
    </button>
  );
}
