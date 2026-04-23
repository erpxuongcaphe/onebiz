"use client";

/**
 * TableFloorPlan — Visual grid of restaurant tables grouped by zone.
 *
 * Color-coded by status:
 *   available  → green   (tap → create new order tab)
 *   occupied   → red     (tap → switch to existing order tab) + timer
 *   reserved   → orange  (tap → status toggle)
 *   cleaning   → gray    (tap → mark available)
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { RestaurantTable, TableStatus } from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";

interface TableFloorPlanProps {
  tables: RestaurantTable[];
  onSelectTable: (table: RestaurantTable) => void;
  /** Map of orderId → order createdAt ISO string, for timer display */
  orderTimestamps?: Record<string, string>;
}

// ── Status config ──

const STATUS_CONFIG: Record<
  TableStatus,
  { bg: string; border: string; text: string; label: string; dot: string }
> = {
  available: {
    bg: "bg-status-success/10 hover:bg-status-success/20",
    border: "border-status-success/25",
    text: "text-status-success",
    label: "Trống",
    dot: "bg-status-success",
  },
  occupied: {
    bg: "bg-status-error/10 hover:bg-status-error/20",
    border: "border-status-error/25",
    text: "text-status-error",
    label: "Đang dùng",
    dot: "bg-status-error",
  },
  reserved: {
    bg: "bg-status-warning/10 hover:bg-status-warning/20",
    border: "border-status-warning/25",
    text: "text-status-warning",
    label: "Đặt trước",
    dot: "bg-status-warning",
  },
  cleaning: {
    bg: "bg-muted hover:bg-muted",
    border: "border-border",
    text: "text-muted-foreground",
    label: "Dọn dẹp",
    dot: "bg-status-neutral",
  },
};

// ── Timer helper ──

function formatElapsed(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "<1'";
  if (totalMin < 60) return `${totalMin}'`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h${m > 0 ? m + "'" : ""}`;
}

// ── Component ──

export function TableFloorPlan({
  tables,
  onSelectTable,
  orderTimestamps,
}: TableFloorPlanProps) {
  // Group by zone
  const zones = useMemo(() => {
    const map = new Map<string, RestaurantTable[]>();
    for (const t of tables) {
      const zone = t.zone || "Khác";
      if (!map.has(zone)) map.set(zone, []);
      map.get(zone)!.push(t);
    }
    // Sort tables within each zone by sortOrder
    for (const arr of map.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return Array.from(map.entries());
  }, [tables]);

  // Summary counts
  const counts = useMemo(() => {
    const c = { available: 0, occupied: 0, reserved: 0, cleaning: 0 };
    for (const t of tables) c[t.status]++;
    return c;
  }, [tables]);

  return (
    <div className="flex flex-col h-full">
      {/* ── Legend ── */}
      <div className="flex items-center gap-4 px-4 py-2 border-b bg-card shrink-0 flex-wrap">
        {(["available", "occupied", "reserved", "cleaning"] as TableStatus[]).map(
          (s) => (
            <div key={s} className="flex items-center gap-1.5 text-xs text-foreground">
              <span
                className={cn("h-2.5 w-2.5 rounded-full", STATUS_CONFIG[s].dot)}
              />
              <span>
                {STATUS_CONFIG[s].label} ({counts[s]})
              </span>
            </div>
          )
        )}
      </div>

      {/* ── Zone grids ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {zones.map(([zoneName, zoneTables]) => (
          <div key={zoneName}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {zoneName}
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 md:gap-2">
              {zoneTables.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  elapsed={
                    table.status === "occupied" &&
                    table.currentOrderId &&
                    orderTimestamps?.[table.currentOrderId]
                      ? formatElapsed(orderTimestamps[table.currentOrderId])
                      : undefined
                  }
                  onSelect={() => onSelectTable(table)}
                />
              ))}
            </div>
          </div>
        ))}

        {tables.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Icon name="group" size={40} className="mb-2" />
            <p className="text-sm">Chưa có bàn nào</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Table card ──

function TableCard({
  table,
  elapsed,
  onSelect,
}: {
  table: RestaurantTable;
  elapsed?: string;
  onSelect: () => void;
}) {
  const cfg = STATUS_CONFIG[table.status];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-lg border-2 p-3 md:p-3 transition-all cursor-pointer select-none active:scale-95",
        "min-h-[96px] md:min-h-[80px]",
        cfg.bg,
        cfg.border
      )}
    >
      {/* Status dot */}
      <span
        className={cn(
          "absolute top-1.5 right-1.5 h-2 w-2 rounded-full",
          cfg.dot
        )}
      />

      {/* Table number */}
      <span className={cn("text-xl md:text-lg font-bold leading-none", cfg.text)}>
        {table.tableNumber}
      </span>

      {/* Table name */}
      <span className="text-xs md:text-[10px] text-muted-foreground mt-0.5 truncate max-w-full">
        {table.name}
      </span>

      {/* Timer for occupied tables */}
      {elapsed && (
        <span className="flex items-center gap-0.5 text-[10px] text-status-error font-medium mt-1">
          <Icon name="schedule" size={10} />
          {elapsed}
        </span>
      )}

      {/* Cleaning indicator */}
      {table.status === "cleaning" && (
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground mt-1">
          <Icon name="auto_awesome" size={10} />
          Dọn
        </span>
      )}

      {/* Capacity */}
      <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground mt-0.5">
        <Icon name="group" size={10} />
        {table.capacity}
      </span>
    </button>
  );
}
