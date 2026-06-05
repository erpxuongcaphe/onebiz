"use client";

/**
 * TableFloorPlan — sơ đồ bàn cho POS FnB.
 * Ưu tiên render canvas tuỳ chỉnh (zones + position absolute).
 * Backward compat: fallback grid nếu zone chưa setup.
 */

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { RestaurantTable, TableStatus } from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts/toast-context";
import {
  getFloorPlanZones,
  getTablesByZone,
  type FloorPlanZone,
} from "@/lib/services";
import type { CanvasTable } from "@/components/shared/floor-plan/floor-plan-canvas";
import {
  TableActionSheet,
  type TableActionKind,
} from "@/components/shared/floor-plan/table-action-sheet";
import { useAuth } from "@/lib/contexts";

const FloorPlanCanvas = dynamic(
  () => import("@/components/shared/floor-plan/floor-plan-canvas").then((m) => m.FloorPlanCanvas),
  { ssr: false },
);

interface TableFloorPlanProps {
  tables: RestaurantTable[];
  onSelectTable: (table: RestaurantTable) => void;
  orderTimestamps?: Record<string, string>;
}

const STATUS_CONFIG: Record<TableStatus, { label: string; dot: string }> = {
  available: { label: "Trống", dot: "bg-status-success" },
  occupied: { label: "Đang phục vụ", dot: "bg-primary" },
  reserved: { label: "Đặt trước", dot: "bg-status-warning" },
  cleaning: { label: "Đang dọn", dot: "bg-status-neutral" },
};

function elapsedMinutes(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

export function TableFloorPlan({
  tables,
  onSelectTable,
  orderTimestamps,
}: TableFloorPlanProps) {
  const { currentBranch } = useAuth();
  const { toast } = useToast();
  const [zones, setZones] = useState<FloorPlanZone[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [zoneTables, setZoneTables] = useState<CanvasTable[]>([]);
  // Action sheet — tap bàn ở chế độ canvas mở dialog Mở đơn / Chuyển / Gộp
  const [actionTable, setActionTable] = useState<CanvasTable | null>(null);

  // Đóng action sheet + chuyển hành động về parent
  const handleAction = (kind: TableActionKind, ct: CanvasTable) => {
    const original = tables.find((t) => t.id === ct.id);
    setActionTable(null);
    if (!original) return;
    if (kind === "open") {
      onSelectTable(original);
      return;
    }
    // Chuyển/Gộp/Hủy đặt — UI scaffold, backend wire sẽ build sau
    const labels: Record<Exclude<TableActionKind, "open">, string> = {
      transfer: "Chuyển bàn",
      merge: "Gộp bàn",
      "cancel-reservation": "Hủy đặt trước",
    };
    toast({
      title: `${labels[kind as Exclude<TableActionKind, "open">]} — đang phát triển`,
      description:
        "Em sẽ build dialog chọn bàn đích + cập nhật đơn ở phiên sau. Tạm thời anh thao tác ở dialog Đơn hiện tại nhé.",
      variant: "info",
    });
  };

  // Load zones (fallback gracefully nếu chưa setup)
  useEffect(() => {
    if (!currentBranch?.id) return;
    let cancelled = false;
    getFloorPlanZones(currentBranch.id)
      .then((zs) => {
        if (cancelled) return;
        setZones(zs);
        if (zs.length > 0 && !activeZoneId) setActiveZoneId(zs[0].id);
      })
      .catch(() => {
        // Silent — fallback grid
        if (!cancelled) setZones([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBranch?.id]);

  // Build map từ tables prop (đã có status + currentOrderId) sang CanvasTable
  useEffect(() => {
    if (!activeZoneId) {
      setZoneTables([]);
      return;
    }
    getTablesByZone(activeZoneId)
      .then((layoutTables) => {
        const byId = new Map(tables.map((t) => [t.id, t]));
        const merged: CanvasTable[] = layoutTables
          .map((l) => {
            const meta = byId.get(l.id);
            if (!meta) return null;
            const elapsed =
              meta.status === "occupied" && meta.currentOrderId
                ? orderTimestamps?.[meta.currentOrderId]
                : undefined;
            return {
              ...l,
              tableNumber: meta.tableNumber,
              name: meta.name,
              capacity: meta.capacity,
              status: meta.status,
              elapsedMinutes: elapsed ? elapsedMinutes(elapsed) : undefined,
              // 1 bàn = 1 đơn hiện tại theo schema FnB OneBiz. Có order chưa
              // thanh toán → badge đỏ "1". Khi support split-bill nhiều đơn
              // cùng lúc, đổi sang count thật từ orders.
              unpaidOrders: meta.currentOrderId ? 1 : 0,
            } as CanvasTable;
          })
          .filter(Boolean) as CanvasTable[];
        setZoneTables(merged);
      })
      .catch(() => setZoneTables([]));
  }, [activeZoneId, tables, orderTimestamps]);

  const activeZone = useMemo(
    () => zones.find((z) => z.id === activeZoneId) ?? null,
    [zones, activeZoneId],
  );

  const counts = useMemo(() => {
    const c = { available: 0, occupied: 0, reserved: 0, cleaning: 0 };
    for (const t of tables) c[t.status]++;
    return c;
  }, [tables]);

  // ─── Fallback grid khi chưa có zone ───
  const useFallback = zones.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b bg-card shrink-0 flex-wrap">
        {(["available", "occupied", "reserved", "cleaning"] as TableStatus[]).map((s) => (
          <div key={s} className="flex items-center gap-2 text-xs text-foreground">
            <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_CONFIG[s].dot)} />
            <span>
              {STATUS_CONFIG[s].label} ({counts[s]})
            </span>
          </div>
        ))}
      </div>

      {/* Zone tabs (chỉ khi có zone) */}
      {!useFallback && zones.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto shrink-0 bg-surface-container-lowest">
          {zones.map((z) => (
            <button
              key={z.id}
              onClick={() => setActiveZoneId(z.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors",
                activeZoneId === z.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card hover:bg-muted text-foreground",
              )}
            >
              {z.name}
            </button>
          ))}
        </div>
      )}

      {/* Canvas hoặc Grid fallback */}
      <div className="flex-1 overflow-auto p-4">
        {!useFallback && activeZone ? (
          <CanvasView
            zone={activeZone}
            tables={zoneTables}
            onSelect={(ct) => setActionTable(ct)}
          />
        ) : (
          <GridFallback
            tables={tables}
            onSelectTable={(t) => {
              // Convert RestaurantTable → CanvasTable shape tối thiểu
              setActionTable({
                id: t.id,
                zoneId: "",
                shape: "square",
                width: 60,
                height: 60,
                rotation: 0,
                positionX: 0,
                positionY: 0,
                color: null,
                locked: false,
                tableNumber: t.tableNumber,
                name: t.name,
                capacity: t.capacity,
                status: t.status,
                unpaidOrders: t.currentOrderId ? 1 : 0,
              });
            }}
            orderTimestamps={orderTimestamps}
          />
        )}
      </div>

      {/* Action sheet khi tap bàn — Mở đơn / Chuyển bàn / Gộp bàn */}
      <TableActionSheet
        table={actionTable}
        zoneName={
          actionTable
            ? activeZone?.name ?? tables.find((t) => t.id === actionTable.id)?.zone ?? undefined
            : undefined
        }
        onAction={handleAction}
        onClose={() => setActionTable(null)}
      />
    </div>
  );
}

// ─── Canvas wrapper với ResizeObserver ───
function CanvasView({
  zone,
  tables,
  onSelect,
}: {
  zone: FloorPlanZone;
  tables: CanvasTable[];
  onSelect: (t: CanvasTable) => void;
}) {
  const [width, setWidth] = useState(0);
  const [ref, setRef] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(ref);
    return () => ro.disconnect();
  }, [ref]);

  return (
    <div ref={setRef} className="flex justify-center">
      {width > 0 && (
        <FloorPlanCanvas
          zone={zone}
          tables={tables}
          mode="view"
          onSelectTable={onSelect}
          containerWidth={width}
        />
      )}
    </div>
  );
}

// ─── Grid fallback (giữ logic cũ) ───
function GridFallback({
  tables,
  onSelectTable,
  orderTimestamps,
}: TableFloorPlanProps) {
  const zonesGroup = useMemo(() => {
    const map = new Map<string, RestaurantTable[]>();
    for (const t of tables) {
      const z = t.zone || "Khác";
      if (!map.has(z)) map.set(z, []);
      map.get(z)!.push(t);
    }
    return Array.from(map.entries());
  }, [tables]);

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Icon name="group" size={40} className="mb-2" />
        <p className="text-sm">Chưa có bàn nào</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {zonesGroup.map(([zoneName, list]) => (
        <div key={zoneName}>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {zoneName}
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-2">
            {list.map((t) => {
              const elapsed =
                t.status === "occupied" && t.currentOrderId
                  ? orderTimestamps?.[t.currentOrderId]
                  : undefined;
              return (
                <button
                  key={t.id}
                  onClick={() => onSelectTable(t)}
                  className={cn(
                    "relative flex flex-col items-center justify-center rounded-lg border-2 p-3 transition-all active:scale-95 min-h-[96px]",
                    bgFor(t.status),
                  )}
                >
                  <span className="text-xl font-bold">{t.tableNumber}</span>
                  <span className="text-xs text-muted-foreground mt-0.5 truncate max-w-full">
                    {t.name}
                  </span>
                  {elapsed && (
                    <span className="text-[10px] text-status-error mt-1">
                      <Icon name="schedule" size={12} className="inline" /> {fmt(elapsed)}
                    </span>
                  )}
                  <span className="text-[9px] text-muted-foreground mt-0.5">
                    <Icon name="group" size={12} className="inline" /> {t.capacity}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function bgFor(s: TableStatus): string {
  switch (s) {
    case "available":
      return "bg-status-success/10 border-status-success/25";
    case "occupied":
      return "bg-primary/10 border-primary/30";
    case "reserved":
      return "bg-status-warning/10 border-status-warning/25";
    case "cleaning":
      return "bg-muted border-border";
  }
}

function fmt(iso: string): string {
  const m = elapsedMinutes(iso);
  if (m < 60) return `${m}'`;
  return `${Math.floor(m / 60)}h${m % 60}'`;
}
