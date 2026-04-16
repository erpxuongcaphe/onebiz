"use client";

/**
 * ShiftIndicator — Small badge in header showing current shift status.
 * Click to view/close shift.
 */

import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Shift } from "@/lib/types/shift";

interface ShiftIndicatorProps {
  shift: Shift | null;
  onClick: () => void;
}

export function ShiftIndicator({ shift, onClick }: ShiftIndicatorProps) {
  if (!shift) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-600/80 text-white hover:bg-red-600 transition-colors shrink-0"
      >
        <Clock className="h-3 w-3" />
        <span>Chưa mở ca</span>
      </button>
    );
  }

  const elapsed = Math.round(
    (Date.now() - new Date(shift.openedAt).getTime()) / 60_000
  );
  const hours = Math.floor(elapsed / 60);
  const mins = elapsed % 60;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-green-600/80 text-white hover:bg-green-600 transition-colors shrink-0"
      title={`Ca: ${shift.cashierName ?? "—"} • ${hours}h${mins}p`}
    >
      <Clock className="h-3 w-3" />
      <span className="hidden sm:inline">{hours}h{mins}p</span>
    </button>
  );
}
