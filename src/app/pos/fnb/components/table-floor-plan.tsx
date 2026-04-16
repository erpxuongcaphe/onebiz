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
import { Users, Clock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RestaurantTable, TableStatus } from "@/lib/types/fnb";

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
    bg: "bg-green-50 hover:bg-green-100",
    border: "border-green-300",
    text: "text-green-700",
    label: "Trống",
    dot: "bg-green-500",
  },
  occupied: {
    bg: "bg-red-50 hover:bg-red-100",
    border: "border-red-300",
    text: "text-red-700",
    label: "Đang dùng",
    dot: "bg-red-500",
  },
  reserved: {
    bg: "bg-orange-50 hover:bg-orange-100",
    border: "border-orange-300",
    text: "text-orange-700",
    label: "Đặt trước",
    dot: "bg-orange-500",
  },
  cleaning: {
    bg: "bg-gray-100 hover:bg-gray-200",
    border: "border-gray-300",
    text: "text-gray-500",
    label: "Dọn dẹp",
    dot: "bg-gray-400",
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
      <div className="flex items-center gap-4 px-4 py-2 border-b bg-white shrink-0 flex-wrap">
        {(["available", "occupied", "reserved", "cleaning"] as TableStatus[]).map(
          (s) => (
            <div key={s} className="flex items-center gap-1.5 text-xs text-gray-600">
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
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
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
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Users className="h-10 w-10 mb-2" />
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
      <span className="text-xs md:text-[10px] text-gray-500 mt-0.5 truncate max-w-full">
        {table.name}
      </span>

      {/* Timer for occupied tables */}
      {elapsed && (
        <span className="flex items-center gap-0.5 text-[10px] text-red-600 font-medium mt-1">
          <Clock className="h-2.5 w-2.5" />
          {elapsed}
        </span>
      )}

      {/* Cleaning indicator */}
      {table.status === "cleaning" && (
        <span className="flex items-center gap-0.5 text-[10px] text-gray-400 mt-1">
          <Sparkles className="h-2.5 w-2.5" />
          Dọn
        </span>
      )}

      {/* Capacity */}
      <span className="flex items-center gap-0.5 text-[9px] text-gray-400 mt-0.5">
        <Users className="h-2.5 w-2.5" />
        {table.capacity}
      </span>
    </button>
  );
}
