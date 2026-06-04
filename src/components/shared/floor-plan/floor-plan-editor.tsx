"use client";

/**
 * Floor Plan Editor — UI gồm palette mẫu bàn + tabs khu vực + canvas + thanh thuộc tính.
 * CEO 04/06/2026 — Sprint 5.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/contexts/toast-context";
import {
  getFloorPlanZones,
  createFloorPlanZone,
  updateFloorPlanZone,
  deleteFloorPlanZone,
  getTablesByZone,
  updateTableLayout,
  createTable as createTableSvc,
  type FloorPlanZone,
  type TableLayout,
} from "@/lib/services";
import { useAuth } from "@/lib/contexts";
import { SHAPE_PRESETS, type ShapePreset } from "./floor-plan-shapes";
import type { CanvasTable } from "./floor-plan-canvas";
import { cn } from "@/lib/utils";

// Lazy load Konva canvas (tránh SSR + giảm bundle)
const FloorPlanCanvas = dynamic(
  () => import("./floor-plan-canvas").then((m) => m.FloorPlanCanvas),
  { ssr: false, loading: () => <CanvasSkeleton /> },
);

interface FloorPlanEditorProps {
  branchId: string;
  branchName?: string;
  /** Scope chỉnh sửa: global = admin sửa mọi branch; branch = manager 1 branch. */
  scope: "global" | "branch";
}

export function FloorPlanEditor({ branchId, branchName, scope }: FloorPlanEditorProps) {
  const { toast } = useToast();
  const { tenant } = useAuth();
  const [zones, setZones] = useState<FloorPlanZone[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [tables, setTables] = useState<CanvasTable[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // ─── Load zones ───
  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    setLoading(true);
    getFloorPlanZones(branchId)
      .then(async (zs) => {
        if (cancelled) return;
        setZones(zs);
        if (zs.length > 0) {
          setActiveZoneId(zs[0].id);
        } else {
          // Auto-tạo zone "Sảnh chính" nếu chưa có
          const newZ = await createFloorPlanZone({ branchId, name: "Sảnh chính" });
          setZones([newZ]);
          setActiveZoneId(newZ.id);
        }
      })
      .catch((err) =>
        toast({
          title: "Không tải được khu vực",
          description: (err as Error).message,
          variant: "error",
        }),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [branchId, toast]);

  // ─── Load tables theo zone ───
  useEffect(() => {
    if (!activeZoneId) {
      setTables([]);
      return;
    }
    let cancelled = false;
    getTablesByZone(activeZoneId)
      .then((ts) => {
        if (!cancelled) {
          setTables(ts.map((t) => ({ ...t } as CanvasTable)));
        }
      })
      .catch((err) =>
        toast({
          title: "Không tải được bàn",
          description: (err as Error).message,
          variant: "error",
        }),
      );
    return () => {
      cancelled = true;
    };
  }, [activeZoneId, toast]);

  // ─── ResizeObserver canvas container ───
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeZoneId]);

  const activeZone = useMemo(
    () => zones.find((z) => z.id === activeZoneId) ?? null,
    [zones, activeZoneId],
  );
  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId) ?? null,
    [tables, selectedTableId],
  );

  // ─── Thêm bàn mới từ palette ───
  const handleAddShape = async (preset: ShapePreset) => {
    if (!activeZone || !tenant?.id) return;
    try {
      const next = await createTableSvc({
        tenantId: tenant.id,
        branchId,
        tableNumber: tables.length + 1,
        name: `Bàn ${tables.length + 1}`,
        capacity: preset.seats,
        zone: activeZone.name,
      });
      // Sau khi tạo, cập nhật shape + position + zone_id qua updateTableLayout
      await updateTableLayout(next.id, {
        shape: preset.shape,
        width: preset.width,
        height: preset.height,
        zoneId: activeZone.id,
        positionX: Math.round(activeZone.canvasWidth / 2 - preset.width / 2),
        positionY: Math.round(activeZone.canvasHeight / 2 - preset.height / 2),
      });
      // Refetch
      const fresh = await getTablesByZone(activeZone.id);
      setTables(fresh as CanvasTable[]);
      setSelectedTableId(next.id);
      toast({ title: `Đã thêm ${preset.label}`, variant: "success" });
    } catch (err) {
      toast({
        title: "Không thêm được bàn",
        description: (err as Error).message,
        variant: "error",
      });
    }
  };

  // ─── Cập nhật layout 1 bàn (debounced via local state) ───
  const handleTableLayoutChange = useCallback(
    (id: string, patch: Partial<TableLayout>) => {
      setTables((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
      // Lưu DB
      updateTableLayout(id, patch).catch((err) =>
        toast({
          title: "Không lưu được vị trí",
          description: (err as Error).message,
          variant: "error",
        }),
      );
    },
    [toast],
  );

  // ─── Thêm zone mới ───
  const handleAddZone = async () => {
    const name = prompt("Tên khu vực mới (vd: Sân vườn, Tầng 2)");
    if (!name?.trim()) return;
    try {
      const z = await createFloorPlanZone({ branchId, name: name.trim() });
      setZones((prev) => [...prev, z]);
      setActiveZoneId(z.id);
      toast({ title: `Đã thêm khu vực ${z.name}`, variant: "success" });
    } catch (err) {
      toast({
        title: "Không tạo được",
        description: (err as Error).message,
        variant: "error",
      });
    }
  };

  // ─── Xoá zone ───
  const handleDeleteZone = async () => {
    if (!activeZone) return;
    if (!confirm(`Xoá khu vực "${activeZone.name}"? Các bàn sẽ bị gỡ khỏi sơ đồ nhưng không xoá.`))
      return;
    try {
      await deleteFloorPlanZone(activeZone.id);
      const remain = zones.filter((z) => z.id !== activeZone.id);
      setZones(remain);
      setActiveZoneId(remain[0]?.id ?? null);
      toast({ title: "Đã xoá khu vực", variant: "success" });
    } catch (err) {
      toast({
        title: "Không xoá được",
        description: (err as Error).message,
        variant: "error",
      });
    }
  };

  // ─── Đổi grid snap ───
  const handleGridChange = async (size: number) => {
    if (!activeZone) return;
    await updateFloorPlanZone(activeZone.id, { gridSize: size });
    setZones((prev) =>
      prev.map((z) => (z.id === activeZone.id ? { ...z, gridSize: size } : z)),
    );
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Icon name="map" size={18} />
            Sơ đồ bàn
          </h2>
          {branchName && (
            <span className="text-sm text-muted-foreground truncate">
              · {branchName}
            </span>
          )}
          {scope === "global" && (
            <span className="text-[10px] bg-primary-fixed text-primary px-2 py-0.5 rounded-full font-medium">
              Toàn hệ thống
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="grid-snap" className="text-xs text-muted-foreground">
            Lưới
          </Label>
          <select
            id="grid-snap"
            value={activeZone?.gridSize ?? 16}
            onChange={(e) => handleGridChange(Number(e.target.value))}
            className="text-xs border rounded px-2 py-1 bg-background"
            disabled={!activeZone}
          >
            <option value={0}>Tắt</option>
            <option value={8}>8px</option>
            <option value={16}>16px</option>
            <option value={32}>32px</option>
          </select>
        </div>
      </div>

      {/* Tabs zone */}
      <div className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto shrink-0 bg-surface-container-lowest">
        {zones.map((z) => (
          <button
            key={z.id}
            onClick={() => {
              setActiveZoneId(z.id);
              setSelectedTableId(null);
            }}
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
        <button
          onClick={handleAddZone}
          className="px-2 py-1.5 rounded-lg text-xs text-primary hover:bg-primary/10 transition-colors flex items-center gap-1"
        >
          <Icon name="add" size={14} /> Khu vực
        </button>
        {activeZone && (
          <button
            onClick={handleDeleteZone}
            className="ml-auto px-2 py-1.5 rounded-lg text-xs text-status-error hover:bg-status-error/10 transition-colors flex items-center gap-1"
            title="Xoá khu vực"
          >
            <Icon name="delete" size={14} />
          </button>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Palette mẫu bàn */}
        <aside className="w-32 md:w-40 border-r p-2 overflow-y-auto bg-surface-container-lowest space-y-2 shrink-0">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-1">
            Mẫu bàn
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {SHAPE_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => handleAddShape(p)}
                className="flex flex-col items-center gap-1 p-2 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors text-[10px]"
                title={`Thêm ${p.label}`}
              >
                <Icon name={p.icon} size={20} className="text-muted-foreground" />
                <span className="font-medium">{p.label}</span>
              </button>
            ))}
          </div>

          {/* Thuộc tính bàn đang chọn */}
          {selectedTable && (
            <div className="mt-4 border-t pt-3 space-y-2">
              <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                Bàn đang chọn
              </p>
              <div className="space-y-1.5 text-xs">
                <div>
                  <Label htmlFor="t-name" className="text-[10px]">Tên</Label>
                  <Input
                    id="t-name"
                    value={selectedTable.name ?? ""}
                    onChange={(e) =>
                      setTables((prev) =>
                        prev.map((t) =>
                          t.id === selectedTable.id
                            ? { ...t, name: e.target.value }
                            : t,
                        ),
                      )
                    }
                    className="h-7 text-xs"
                  />
                </div>
                <button
                  onClick={() =>
                    handleTableLayoutChange(selectedTable.id, {
                      locked: !selectedTable.locked,
                    })
                  }
                  className={cn(
                    "w-full px-2 py-1.5 rounded text-xs flex items-center justify-center gap-1 border",
                    selectedTable.locked
                      ? "bg-status-warning/10 border-status-warning/30 text-status-warning"
                      : "border-border hover:bg-muted",
                  )}
                >
                  <Icon name={selectedTable.locked ? "lock" : "lock_open"} size={12} />
                  {selectedTable.locked ? "Đã khoá" : "Khoá vị trí"}
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto p-4 flex items-start justify-center bg-muted/30 min-h-0"
        >
          {loading || !activeZone ? (
            <CanvasSkeleton />
          ) : (
            <FloorPlanCanvas
              zone={activeZone}
              tables={tables}
              mode="edit"
              selectedTableId={selectedTableId}
              onSelectedTableIdChange={setSelectedTableId}
              onTableLayoutChange={handleTableLayoutChange}
              containerWidth={containerWidth - 32}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CanvasSkeleton() {
  return (
    <div className="flex items-center justify-center text-muted-foreground">
      <Icon name="progress_activity" className="animate-spin" size={20} />
    </div>
  );
}
