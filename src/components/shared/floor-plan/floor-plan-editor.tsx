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
  getTablesByBranch,
  updateTableLayout,
  createTable as createTableSvc,
  type FloorPlanZone,
  type TableLayout,
} from "@/lib/services";
import { useAuth } from "@/lib/contexts";
import { SHAPE_PRESETS, type ShapePreset } from "./floor-plan-shapes";
import { DECORATION_PRESETS, type DecorationPreset } from "./decoration-shapes";
import { useUndoStack } from "./use-undo-stack";
import type { CanvasTable } from "./floor-plan-canvas";
import {
  getDecorationsByZone,
  createDecoration,
  updateDecoration,
  deleteDecoration,
  uploadFloorPlanBackground,
  removeFloorPlanBackground,
  type FloorPlanDecoration,
} from "@/lib/services/supabase/floor-plan-decorations";
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
  const [decorations, setDecorations] = useState<FloorPlanDecoration[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedDecorationId, setSelectedDecorationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  // ─── Undo/Redo stack ───
  type Snapshot = { tables: CanvasTable[]; decorations: FloorPlanDecoration[] };
  const undoStack = useUndoStack<Snapshot>(
    { tables, decorations },
    (snap) => {
      setTables(snap.tables);
      setDecorations(snap.decorations);
      // Đồng bộ lên server best-effort
      snap.tables.forEach((t) =>
        updateTableLayout(t.id, {
          positionX: t.positionX,
          positionY: t.positionY,
          width: t.width,
          height: t.height,
          rotation: t.rotation,
        }).catch(() => undefined),
      );
      snap.decorations.forEach((d) =>
        updateDecoration(d.id, {
          positionX: d.positionX,
          positionY: d.positionY,
          width: d.width,
          height: d.height,
          rotation: d.rotation,
        }).catch(() => undefined),
      );
    },
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  // Mobile phone detect — chỉ check client-side để tránh hydration mismatch
  const [isMobilePhone, setIsMobilePhone] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobilePhone(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

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

  // ─── Load tables + decorations theo zone ───
  useEffect(() => {
    if (!activeZoneId) {
      setTables([]);
      setDecorations([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      getTablesByZone(activeZoneId),
      getDecorationsByZone(activeZoneId).catch(() => [] as FloorPlanDecoration[]),
    ])
      .then(([ts, ds]) => {
        if (!cancelled) {
          setTables(ts.map((t) => ({ ...t } as CanvasTable)));
          setDecorations(ds);
        }
      })
      .catch((err) =>
        toast({
          title: "Không tải được bàn / đồ trang trí",
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
  const selectedDecoration = useMemo(
    () => decorations.find((decoration) => decoration.id === selectedDecorationId) ?? null,
    [decorations, selectedDecorationId],
  );

  // ─── Thêm bàn mới từ palette ───
  const handleAddShape = async (preset: ShapePreset) => {
    if (!activeZone || !tenant?.id) return;
    try {
      // Numbering is branch-wide, not per floor-plan zone. Reusing
      // `tables.length + 1` made a new zone try to create an existing Bàn 1.
      const branchTables = await getTablesByBranch(branchId);
      const nextTableNumber = branchTables.reduce(
        (largest, table) => Math.max(largest, table.tableNumber ?? 0),
        0,
      ) + 1;
      // RPC 00323: tạo bàn gán LUÔN khu + hình + vị trí trong một giao dịch
      const next = await createTableSvc({
        branchId,
        tableNumber: nextTableNumber,
        name: `Bàn ${nextTableNumber}`,
        capacity: preset.seats,
        zone: activeZone.name,
        zoneId: activeZone.id,
        shape: preset.shape,
        positionX: Math.round(activeZone.canvasWidth / 2 - preset.width / 2),
        positionY: Math.round(activeZone.canvasHeight / 2 - preset.height / 2),
      });
      await updateTableLayout(next.id, {
        width: preset.width,
        height: preset.height,
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

  // Push undo sau mỗi commit (debounced thực tế bằng React batching)
  const pushUndo = undoStack.push;
  useEffect(() => {
    pushUndo("layout-change");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.length, decorations.length]);

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
    if (!confirm(`Xoá khu vực "${activeZone.name}"? Nếu khu còn bàn, hãy chuyển bàn sang khu khác trước — hệ thống sẽ chặn.`))
      return;
    try {
      await deleteFloorPlanZone(branchId, activeZone.id);
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

  // ─── Decoration handlers ───
  const handleAddDecoration = async (preset: DecorationPreset) => {
    if (!activeZone) return;
    try {
      const d = await createDecoration({
        branchId,
        zoneId: activeZone.id,
        kind: preset.kind,
        label: preset.label,
        positionX: Math.round(activeZone.canvasWidth / 2 - preset.width / 2),
        positionY: Math.round(activeZone.canvasHeight / 2 - preset.height / 2),
        width: preset.width,
        height: preset.height,
        color: preset.color,
        icon: preset.icon,
      });
      setDecorations((prev) => [...prev, d]);
      setSelectedDecorationId(d.id);
    } catch (err) {
      toast({
        title: "Không thêm được",
        description: (err as Error).message,
        variant: "error",
      });
    }
  };

  const handleDecorChange = useCallback(
    (id: string, patch: Partial<FloorPlanDecoration>) => {
      setDecorations((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      );
      updateDecoration(id, patch).catch((err) =>
        toast({
          title: "Không lưu trang trí",
          description: (err as Error).message,
          variant: "error",
        }),
      );
    },
    [toast],
  );

  const handleDeleteSelectedDecor = async () => {
    if (!selectedDecorationId) return;
    await deleteDecoration(selectedDecorationId);
    setDecorations((prev) => prev.filter((d) => d.id !== selectedDecorationId));
    setSelectedDecorationId(null);
  };

  // ─── Upload background image ───
  const handleUploadBg = async (file: File) => {
    if (!activeZone) return;
    setUploadingBg(true);
    try {
      const url = await uploadFloorPlanBackground(branchId, activeZone.id, file);
      await updateFloorPlanZone(branchId, activeZone.id, { backgroundUrl: url });
      setZones((prev) =>
        prev.map((z) =>
          z.id === activeZone.id ? { ...z, backgroundUrl: url } : z,
        ),
      );
      toast({ title: "Đã tải ảnh nền", variant: "success" });
    } catch (err) {
      toast({
        title: "Tải ảnh thất bại",
        description: (err as Error).message,
        variant: "error",
      });
    } finally {
      setUploadingBg(false);
    }
  };

  const handleRemoveBg = async () => {
    if (!activeZone) return;
    await removeFloorPlanBackground(branchId, activeZone.id);
    await updateFloorPlanZone(branchId, activeZone.id, { backgroundUrl: null });
    setZones((prev) =>
      prev.map((z) => (z.id === activeZone.id ? { ...z, backgroundUrl: null } : z)),
    );
    toast({ title: "Đã xoá ảnh nền", variant: "info" });
  };

  const handleBgOpacity = async (val: number) => {
    if (!activeZone) return;
    setZones((prev) =>
      prev.map((z) =>
        z.id === activeZone.id ? { ...z, backgroundOpacity: val } : z,
      ),
    );
    await updateFloorPlanZone(branchId, activeZone.id, { backgroundOpacity: val });
  };

  // ─── Đổi grid snap ───
  const handleGridChange = async (size: number) => {
    if (!activeZone) return;
    await updateFloorPlanZone(branchId, activeZone.id, { gridSize: size });
    setZones((prev) =>
      prev.map((z) => (z.id === activeZone.id ? { ...z, gridSize: size } : z)),
    );
  };

  // ─── Đổi tầng cho zone ───
  const handleFloorChange = async (level: number) => {
    if (!activeZone) return;
    await updateFloorPlanZone(branchId, activeZone.id, { floorLevel: level });
    setZones((prev) =>
      prev.map((z) => (z.id === activeZone.id ? { ...z, floorLevel: level } : z)),
    );
  };

  // ─── Đổi màu phủ ───
  const handleOverlayColorChange = async (color: string | null) => {
    if (!activeZone) return;
    await updateFloorPlanZone(branchId, activeZone.id, { overlayColor: color });
    setZones((prev) =>
      prev.map((z) => (z.id === activeZone.id ? { ...z, overlayColor: color } : z)),
    );
  };

  // ─── In sơ đồ ───
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-2 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="flex shrink-0 items-center gap-2 whitespace-nowrap text-base font-semibold">
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
        <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 lg:w-auto lg:pb-0">
          {/* Tầng */}
          <Label htmlFor="floor-level" className="text-xs text-muted-foreground">Tầng</Label>
          <select
            id="floor-level"
            value={activeZone?.floorLevel ?? 1}
            onChange={(e) => handleFloorChange(Number(e.target.value))}
            className="text-xs border rounded px-2 py-1 bg-background"
            disabled={!activeZone}
          >
            {[1, 2, 3, 4, 5].map((f) => (
              <option key={f} value={f}>{f === 1 ? "Trệt" : `Lầu ${f - 1}`}</option>
            ))}
          </select>
          {/* Lưới */}
          <Label htmlFor="grid-snap" className="text-xs text-muted-foreground">Lưới</Label>
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
          {/* Phủ màu */}
          <Label htmlFor="overlay-color" className="text-xs text-muted-foreground">Phủ màu</Label>
          <input
            id="overlay-color"
            type="color"
            value={activeZone?.overlayColor ?? "#ffffff"}
            onChange={(e) => handleOverlayColorChange(e.target.value)}
            disabled={!activeZone}
            className="h-7 w-7 rounded border cursor-pointer"
          />
          {activeZone?.overlayColor && (
            <button
              onClick={() => handleOverlayColorChange(null)}
              className="text-[10px] text-status-error hover:underline"
              title="Bỏ phủ màu"
            >Bỏ</button>
          )}
          {/* Hoàn tác / Làm lại */}
          <Button
            size="sm"
            variant="ghost"
            onClick={undoStack.undo}
            disabled={!undoStack.canUndo}
            className="h-7 w-7 p-0"
            title="Hoàn tác (Ctrl+Z)"
          >
            <Icon name="undo" size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={undoStack.redo}
            disabled={!undoStack.canRedo}
            className="h-7 w-7 p-0"
            title="Làm lại (Ctrl+Y)"
          >
            <Icon name="redo" size={14} />
          </Button>
          {/* In */}
          <Button size="sm" variant="outline" onClick={handlePrint} className="h-7 text-xs">
            <Icon name="print" size={14} className="mr-1" />In
          </Button>
        </div>
      </div>

      {/* Tabs zone — nhóm theo tầng */}
      <div className="flex items-center gap-3 px-4 py-2 border-b overflow-x-auto shrink-0 bg-surface-container-lowest">
        {Array.from(new Set(zones.map((z) => z.floorLevel)))
          .sort((a, b) => a - b)
          .map((floor) => (
            <div key={floor} className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                {floor === 1 ? "Trệt" : `Lầu ${floor - 1}`}:
              </span>
              {zones
                .filter((z) => z.floorLevel === floor)
                .map((z) => (
                  <button
                    key={z.id}
                    onClick={() => {
                      setActiveZoneId(z.id);
                      setSelectedTableId(null);
                      setSelectedDecorationId(null);
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
            </div>
          ))}
        <button
          onClick={handleAddZone}
          className="px-2 py-1.5 rounded-lg text-xs text-primary hover:bg-primary/10 transition-colors flex items-center gap-1"
        >
          <Icon name="add" size={14} /> Khu vực
        </button>
        <button
          type="button"
          onClick={() => setMobileToolsOpen((open) => !open)}
          className={cn(
            "flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-primary transition-colors lg:hidden",
            mobileToolsOpen ? "bg-primary text-primary-foreground" : "hover:bg-primary/10",
          )}
          aria-expanded={mobileToolsOpen}
          aria-controls="floor-plan-tools"
        >
          <Icon name="construction" size={14} /> Công cụ
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

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Palette mẫu bàn + đồ trang trí + ảnh nền */}
        <aside
          id="floor-plan-tools"
          className={cn(
            "shrink-0 space-y-3 overflow-y-auto bg-surface-container-lowest p-2 lg:block lg:w-52 lg:border-r",
            mobileToolsOpen ? "block max-h-64 border-b" : "hidden",
          )}
        >
          {/* Bàn */}
          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
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

          {/* Trang trí */}
          <div className="border-t pt-3">
            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-1.5">
              Đồ trang trí
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {DECORATION_PRESETS.map((d) => (
                <button
                  key={d.kind}
                  onClick={() => handleAddDecoration(d)}
                  className="flex flex-col items-center gap-1 p-2 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors text-[10px]"
                  title={`Thêm ${d.label}`}
                >
                  <Icon name={d.icon} size={18} style={{ color: d.color }} />
                  <span className="font-medium">{d.label}</span>
                </button>
              ))}
            </div>
              {selectedDecorationId && (
                <button
                onClick={handleDeleteSelectedDecor}
                className="w-full mt-2 px-2 py-1.5 rounded text-xs flex items-center justify-center gap-1 border border-status-error/30 text-status-error hover:bg-status-error/10"
              >
                <Icon name="delete" size={12} />
                Xoá vật đang chọn
                </button>
              )}
              {selectedDecoration && (
                <div className="mt-2 space-y-2 rounded-md border border-border bg-background p-2">
                  <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
                    Vật đang chọn
                  </p>
                  <div>
                    <Label htmlFor="decoration-label" className="text-[10px]">Tên hiển thị</Label>
                    <Input
                      id="decoration-label"
                      value={selectedDecoration.label ?? ""}
                      onChange={(event) =>
                        setDecorations((previous) =>
                          previous.map((decoration) =>
                            decoration.id === selectedDecoration.id
                              ? { ...decoration, label: event.target.value }
                              : decoration,
                          ),
                        )
                      }
                      onBlur={(event) =>
                        handleDecorChange(selectedDecoration.id, { label: event.target.value })
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleDecorChange(selectedDecoration.id, {
                        locked: !selectedDecoration.locked,
                      })
                    }
                    className={cn(
                      "w-full px-2 py-1.5 rounded text-xs flex items-center justify-center gap-1 border",
                      selectedDecoration.locked
                        ? "bg-status-warning/10 border-status-warning/30 text-status-warning"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <Icon name={selectedDecoration.locked ? "lock" : "lock_open"} size={12} />
                    {selectedDecoration.locked ? "Đang khoá vị trí" : "Khoá vị trí"}
                  </button>
                </div>
              )}
            </div>

          {/* Ảnh nền */}
          <div className="border-t pt-3">
            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-1.5">
              Ảnh nền quán
            </p>
            {activeZone?.backgroundUrl ? (
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground truncate">
                  Đã có ảnh nền
                </p>
                <div className="space-y-1">
                  <Label className="text-[10px]">Độ trong {activeZone.backgroundOpacity}%</Label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={activeZone.backgroundOpacity}
                    onChange={(e) => handleBgOpacity(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                <button
                  onClick={handleRemoveBg}
                  className="w-full px-2 py-1.5 rounded text-xs flex items-center justify-center gap-1 border border-border hover:bg-muted"
                >
                  <Icon name="delete" size={12} />
                  Xoá ảnh nền
                </button>
              </div>
            ) : (
              <label className="block">
                <span className="cursor-pointer flex flex-col items-center gap-1 p-3 rounded-lg border border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors text-[10px]">
                  <Icon name={uploadingBg ? "progress_activity" : "add_photo_alternate"} size={20} className={uploadingBg ? "animate-spin" : "text-muted-foreground"} />
                  <span className="font-medium text-center">
                    {uploadingBg ? "Đang tải..." : "Tải ảnh nền"}
                  </span>
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingBg}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadBg(file);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
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
          className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-muted/30 p-2 sm:p-4"
        >
          {loading || !activeZone ? (
            <CanvasSkeleton />
          ) : (
            <FloorPlanCanvas
              zone={activeZone}
              tables={tables}
              decorations={decorations}
              mode="edit"
              selectedTableId={selectedTableId}
              onSelectedTableIdChange={(id) => {
                setSelectedTableId(id);
                if (id) setSelectedDecorationId(null);
              }}
              selectedDecorationId={selectedDecorationId}
              onSelectedDecorationIdChange={setSelectedDecorationId}
              onTableLayoutChange={handleTableLayoutChange}
              onDecorationChange={handleDecorChange}
              containerWidth={Math.max(0, containerWidth - (isMobilePhone ? 16 : 32))}
              enableTouchZoom
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
