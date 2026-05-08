"use client";
import { useEffect, useState } from "react";
import type { Shift } from "@/lib/types/shift";
import { Icon } from "@/components/ui/icon";

interface ShiftIndicatorProps {
  shift: Shift | null;
  onClick: () => void;
}

export function ShiftIndicator({ shift, onClick }: ShiftIndicatorProps) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!shift) {
      setNow(null);
      return;
    }

    const updateNow = () => setNow(Date.now());
    updateNow();
    const intervalId = window.setInterval(updateNow, 60_000);

    return () => window.clearInterval(intervalId);
  }, [shift]);

  if (!shift) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-status-error/80 text-white hover:bg-status-error transition-colors shrink-0"
      >
        <Icon name="schedule" size={14} />
        <span className="sm:hidden">Ca</span>
        <span className="hidden sm:inline">Chưa mở ca</span>
      </button>
    );
  }

  const openedAt = new Date(shift.openedAt).getTime();
  const elapsed = Math.max(
    0,
    Math.round(((now ?? openedAt) - openedAt) / 60_000)
  );
  const hours = Math.floor(elapsed / 60);
  const mins = elapsed % 60;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-status-success/80 text-white hover:bg-status-success transition-colors shrink-0"
      title={`Ca: ${shift.cashierName ?? "—"} • ${hours}h${mins}p`}
    >
      <Icon name="schedule" size={14} />
      <span className="hidden sm:inline">{hours}h{mins}p</span>
    </button>
  );
}
