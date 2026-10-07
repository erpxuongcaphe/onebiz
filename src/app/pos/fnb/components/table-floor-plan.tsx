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
  getDecorationsByZone,
  getFloorPlanZones,
  getTablesByZone,
  type FloorPlanDecoration,
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
  onTransferTable?: (table: RestaurantTable) => void;
  onMergeTable?: (table: RestaurantTable) => void;
  orderTimestamps?: Record<string, string>;
}

const STATUS_CONFIG: Record<TableStatus, { label: string; dot: string }> = {
  available: { label: "Trống", dot: "bg-status-success" },
  occupied: { label: "Đang phục vụ", dot: "bg-amber-500" },
  reserved: { label: "Đặt trước", dot: "bg-blue-500" },
  cleaning: { label: "Đang dọn", dot: "bg-status-neutral" },
};

function elapsedMinutes(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

export function TableFloorPlan({
  tables,
  onSelectTable,
  onTransferTable,
  onMergeTable,
  orderTimestamps,
}: TableFloorPlanProps) {
  const { currentBranch, user, tenant } = useAuth();
  const { toast } = useToast();
  const viewKey = `onebiz:fnb-table-view:${tenant?.id}:${user?.id}:${currentBranch?.id}`;
  const [viewPreference, setViewPreference] = useState<{ key: string; view: "plan" | "list" }>({ key: "", view: "plan" });
  const tableView = viewPreference.key === viewKey ? viewPreference.view : "plan";
  useEffect(() => {
    try { setViewPreference({ key: viewKey, view: localStorage.getItem(viewKey) === "list" ? "list" : "plan" }); }
    catch { setViewPreference({ key: viewKey, view: "plan" }); }
  }, [viewKey]);
  const setTableView = (view: "plan" | "list") => { setViewPreference({ key: viewKey, view }); };
  const chooseTableView = (view: "plan" | "list") => {
    setTableView(view);
    try { localStorage.setItem(viewKey, view); } catch { /* preference remains usable in this visit */ }
  };
  const [tableSearch, setTableSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TableStatus | "all">("all");
  const [zones, setZones] = useState<FloorPlanZone[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [zoneTables, setZoneTables] = useState<CanvasTable[]>([]);
  const [loadedZoneId, setLoadedZoneId] = useState<string | null>(null);
  // POS and the editor share the exact same saved plan. POS renders these
  // decorations read-only, so a cashier can orient themselves without being
  // able to accidentally change the layout during service.
  const [decorations, setDecorations] = useState<FloorPlanDecoration[]>([]);
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
    if (kind === "transfer") {
      onTransferTable?.(original);
      return;
    }
    onMergeTable?.(original);
  };

  // Load zones (fallback gracefully nếu chưa setup)
  useEffect(() => {
    if (!currentBranch?.id) return;
    let cancelled = false;
    setActiveZoneId(null);
    setZones([]);
    setActionTable(null);
    setTableSearch("");
    setStatusFilter("all");
    getFloorPlanZones(currentBranch.id)
      .then((zs) => {
        if (cancelled) return;
        setZones(zs);
        setActiveZoneId(zs[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[FloorPlan] load zones failed:", err);
        // Fallback grid view (không có sơ đồ trực quan)
        setZones([]);
        toast({
          title: "Không tải được khu vực sơ đồ",
          description:
            err instanceof Error ? err.message : "Hiển thị grid thay thế",
          variant: "warning",
        });
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
      setDecorations([]);
      setLoadedZoneId(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      getTablesByZone(activeZoneId),
      getDecorationsByZone(activeZoneId).catch((err: unknown) => {
        console.error("[FloorPlan] load decorations for zone failed:", err);
        if (!cancelled) {
          toast({
            title: "Không tải được vật thể sơ đồ",
            description: "Bàn vẫn hiển thị. Hãy tải lại trước khi dùng sơ đồ để định vị.",
            variant: "warning",
          });
        }
        return [] as FloorPlanDecoration[];
      }),
    ])
      .then(([layoutTables, loadedDecorations]) => {
        if (cancelled) return;
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
        setDecorations(loadedDecorations);
        setLoadedZoneId(activeZoneId);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[FloorPlan] load tables for zone failed:", err);
        setZoneTables([]);
        setDecorations([]);
        setLoadedZoneId(activeZoneId);
        toast({
          title: "Không tải được bàn trong khu vực",
          description:
            err instanceof Error
              ? err.message
              : "Thử chuyển khu vực khác hoặc reload",
          variant: "error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeZoneId, tables, orderTimestamps, toast]);

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
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-white dark:bg-card px-4 py-2">
        <div><h2 className="text-base font-semibold">Chọn bàn phục vụ</h2><p className="text-xs text-muted-foreground">Chọn bàn để mở đơn; chuyển và gộp bàn trong chi tiết.</p></div>
        <div className="flex gap-1" role="group" aria-label="Cách xem bàn">
          <button type="button" aria-pressed={tableView === "plan"} onClick={() => { chooseTableView("plan"); setStatusFilter("all"); setTableSearch(""); }} className={cn("min-h-11 rounded-lg px-3 text-sm font-medium", tableView === "plan" ? "bg-primary/10 text-primary" : "hover:bg-muted")}>Sơ đồ</button>
          <button type="button" aria-pressed={tableView === "list"} onClick={() => chooseTableView("list")} className={cn("min-h-11 rounded-lg px-3 text-sm font-medium", tableView === "list" ? "bg-primary/10 text-primary" : "hover:bg-muted")}>Danh sách</button>
        </div>
      </div>
      <div className="shrink-0 border-b border-border bg-white dark:bg-card px-4 py-2"><input aria-label="Tìm bàn" placeholder="Tìm số bàn, tên hoặc khu vực..." value={tableSearch} onChange={(event) => { setTableSearch(event.target.value); setTableView("list"); }} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm sm:max-w-sm" /></div>
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b bg-card shrink-0 flex-wrap">
        <button type="button" aria-pressed={statusFilter === "all"} onClick={() => { setStatusFilter("all"); setTableView("list"); }}
          className={cn("min-h-10 rounded px-2 text-sm", statusFilter === "all" && "bg-primary/10 text-primary")}>Tất cả ({tables.length})</button>
        {(["available", "occupied", "reserved", "cleaning"] as TableStatus[]).map((s) => (
          <button type="button" key={s} aria-pressed={statusFilter === s}
            onClick={() => { setStatusFilter(s); setTableView("list"); }}
            className={cn("flex min-h-10 items-center gap-2 rounded px-2 text-sm text-foreground", statusFilter === s && "bg-primary/10 ring-1 ring-primary/30")}>
            <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_CONFIG[s].dot)} />
            <span>
              {STATUS_CONFIG[s].label} ({counts[s]})
            </span>
          </button>
        ))}
      </div>

      {/* Zone tabs (chỉ khi có zone) */}
      {tableView === "plan" && !useFallback && zones.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto shrink-0 bg-surface-container-lowest">
          {zones.map((z) => (
            <button
              key={z.id}
              onClick={() => {
                setActionTable(null);
                setActiveZoneId(z.id);
              }}
              className={cn(
                "min-h-11 px-3 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
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
      <div className="flex-1 overflow-auto p-2 sm:p-4">
        {tableView === "plan" && !useFallback && activeZone ? (
          loadedZoneId !== activeZoneId ? (
            <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Icon name="progress_activity" size={18} className="animate-spin" />
              Đang tải bàn {activeZone.name}...
            </div>
          ) : (
          <CanvasView
            zone={activeZone}
            tables={zoneTables}
            decorations={decorations}
            onSelect={(ct) => setActionTable(ct)}
          />
          )
        ) : (
          <GridFallback
            tables={tables.filter((table) => tableView === "plan" ||
              ((statusFilter === "all" || table.status === statusFilter) &&
              (table.tableNumber + " " + table.name + " " + (table.zone ?? "")).toLocaleLowerCase("vi").includes(tableSearch.trim().toLocaleLowerCase("vi"))))
              .sort((a, b) => a.tableNumber - b.tableNumber)}
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
            ? tables.find((t) => t.id === actionTable.id)?.zone ?? activeZone?.name ?? undefined
            : undefined
        }
        onAction={handleAction}
        onClose={() => setActionTable(null)}
        canTransfer={Boolean(onTransferTable)}
        canMerge={
          Boolean(onMergeTable) &&
          tables.some(
            (table) =>
              table.id !== actionTable?.id &&
              table.status === "occupied" &&
              Boolean(table.currentOrderId),
          )
        }
      />
    </div>
  );
}

// ─── Canvas wrapper với ResizeObserver ───
function CanvasView({
  zone,
  tables,
  decorations,
  onSelect,
}: {
  zone: FloorPlanZone;
  tables: CanvasTable[];
  decorations: FloorPlanDecoration[];
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
          decorations={decorations}
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
        <p className="text-sm">Không có bàn phù hợp</p>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3 md:gap-2">
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
                  <span className="text-2xl font-bold tabular-nums">{t.tableNumber}</span>
                  <span className="text-sm mt-0.5 break-words max-w-full">
                    {t.name}
                  </span>
                  <span className="mt-1 text-xs font-medium">{STATUS_CONFIG[t.status].label}</span>
                  {elapsed && (
                    <span className="text-xs text-status-error mt-1">
                      <Icon name="schedule" size={12} className="inline" /> {fmt(elapsed)}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground mt-0.5">
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
      return "bg-amber-50 border-amber-500 text-amber-950 dark:bg-amber-950 dark:text-amber-100";
    case "reserved":
      return "bg-blue-50 border-blue-500 text-blue-950 dark:bg-blue-950 dark:text-blue-100";
    case "cleaning":
      return "bg-muted border-border";
  }
}

function fmt(iso: string): string {
  const m = elapsedMinutes(iso);
  if (m < 60) return `${m}'`;
  return `${Math.floor(m / 60)}h${m % 60}'`;
}
