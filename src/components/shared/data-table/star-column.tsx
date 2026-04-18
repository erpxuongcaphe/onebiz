"use client";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

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
      <Icon name="star"
        className={cn(
                                  "h-4 w-4 transition-colors",
                                  starred
                                    ? "fill-status-warning text-status-warning"
                                    : "fill-none text-muted-foreground/40 hover:text-status-warning"
                                )}
      />
    </button>
  );
}
