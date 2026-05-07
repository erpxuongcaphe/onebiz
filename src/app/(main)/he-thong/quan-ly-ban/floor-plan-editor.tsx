"use client";

/**
 * FloorPlanEditor — Drag-drop editor cho admin sắp xếp bàn (Sprint C — CEO 06/05).
 *
 * CEO feedback: "nếu có thể làm sơ đồ bàn theo ý để có thể giống như đang ở
 * quán là đẹp nhất". Đây là editor visual, dùng pointer events thay vì
 * @dnd-kit để tránh thêm dependency.
 *
 * Capabilities:
 *   - Absolute positioning bằng positionX/positionY (đã sẵn schema)
 *   - Drag bàn bằng chuột/touch → snap grid 32px khi thả
 *   - Bound trong canvas (không drag ra ngoài)
 *   - Save vị trí qua updateTable() khi pointer up
 *   - Multi-zone: tab switch giữa các zone, mỗi zone là 1 canvas riêng
 *   - Shape derived từ capacity: 2 chỗ → vuông nhỏ, 4 chỗ → tròn, 6+ → hình
 *     dài (sofa/bàn ăn). Sprint sau (E) có thể migration thêm field shape.
 *
 * KHÔNG handle:
 *   - Resize handle (Sprint sau nếu CEO cần)
 *   - Multi-select drag
 *   - Undo/Redo (state-only, không history)
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { RestaurantTable } from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { updateTable } from "@/lib/services/supabase/fnb-tables";
import { useToast } from "@/lib/contexts";

// ── Constants ──

/** Bước snap grid khi drop bàn (px). Bằng background grid để align tự nhiên. */
const SNAP = 32;
/** Kích thước icon bàn theo capacity. */
const TABLE_SIZE = {
  small: 64, // 1-2 chỗ
  medium: 80, // 3-4 chỗ
  large: 96, // 5-6 chỗ
  xlarge: 144, // 7+ chỗ (bàn dài)
} as const;

type Shape = "round" | "square" | "long" | "sofa";

function deriveShape(capacity: number): Shape {
  if (capacity >= 7) return "long";
  if (capacity >= 5) return "sofa";
  if (capacity >= 3) return "round";
  return "square";
}

function tableSize(capacity: number): { w: number; h: number } {
  if (capacity >= 7) return { w: TABLE_SIZE.xlarge, h: TABLE_SIZE.medium - 8 };
  if (capacity >= 5) return { w: TABLE_SIZE.large + 32, h: TABLE_SIZE.large };
  if (capacity >= 3) return { w: TABLE_SIZE.medium, h: TABLE_SIZE.medium };
  return { w: TABLE_SIZE.small, h: TABLE_SIZE.small };
}

interface FloorPlanEditorProps {
  /** Bàn của zone được chọn. */
  tables: RestaurantTable[];
  /** Sau khi save thành công 1 bàn → reload list. */
  onSaved?: () => void;
}

interface DragState {
  tableId: string;
  pointerId: number;
  /** Offset từ gốc bàn (top-left) đến chỗ click — để drag không "nhảy". */
  offsetX: number;
  offsetY: number;
  /** Vị trí hiện tại của bàn trong canvas (px) — local state khi drag. */
  x: number;
  y: number;
}

export function FloorPlanEditor({ tables, onSaved }: FloorPlanEditorProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Local positions override khi đang drag (để re-render mượt mỗi pointermove
  // không cần round-trip server). Sau khi save xong → clear → fall back về
  // tables prop từ DB.
  const [localPos, setLocalPos] = useState<Record<string, { x: number; y: number }>>({});

  const positionedTables = useMemo(
    () =>
      tables.map((t) => {
        const local = localPos[t.id];
        return {
          ...t,
          x: local?.x ?? t.positionX ?? 0,
          y: local?.y ?? t.positionY ?? 0,
        };
      }),
    [tables, localPos],
  );

  // Snap helper
  const snap = useCallback((v: number) => Math.round(v / SNAP) * SNAP, []);

  // Clamp vào canvas bounds
  const clamp = useCallback(
    (x: number, y: number, tableW: number, tableH: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x, y };
      const w = canvas.clientWidth - tableW;
      const h = canvas.clientHeight - tableH;
      return {
        x: Math.max(0, Math.min(w, x)),
        y: Math.max(0, Math.min(h, y)),
      };
    },
    [],
  );

  // Pointer down trên 1 bàn → bắt đầu drag
  const onPointerDown = useCallback(
    (e: React.PointerEvent, table: RestaurantTable & { x: number; y: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const offsetX = e.clientX - rect.left - table.x;
      const offsetY = e.clientY - rect.top - table.y;
      setDrag({
        tableId: table.id,
        pointerId: e.pointerId,
        offsetX,
        offsetY,
        x: table.x,
        y: table.y,
      });
      // Capture pointer để pointermove + pointerup luôn fire trên element này
      // ngay cả khi pointer ra ngoài bàn.
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [],
  );

  // Pointer move khi đang drag → update local pos
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const rawX = e.clientX - rect.left - drag.offsetX;
      const rawY = e.clientY - rect.top - drag.offsetY;

      const table = tables.find((t) => t.id === drag.tableId);
      if (!table) return;
      const { w, h } = tableSize(table.capacity);
      const clamped = clamp(rawX, rawY, w, h);

      setDrag({ ...drag, x: clamped.x, y: clamped.y });
      // Cập nhật local pos để re-render bàn đang drag — không snap khi drag,
      // chỉ snap khi thả để user thấy preview free-form.
      setLocalPos((prev) => ({
        ...prev,
        [drag.tableId]: { x: clamped.x, y: clamped.y },
      }));
    },
    [drag, tables, clamp],
  );

  // Pointer up → snap + save
  const onPointerUp = useCallback(
    async (e: React.PointerEvent) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const tableId = drag.tableId;
      const snappedX = snap(drag.x);
      const snappedY = snap(drag.y);

      setLocalPos((prev) => ({
        ...prev,
        [tableId]: { x: snappedX, y: snappedY },
      }));
      setDrag(null);
      setSavingId(tableId);

      try {
        await updateTable(tableId, { positionX: snappedX, positionY: snappedY });
        // Save thành công → clear local override (DB sẽ là source of truth).
        // Onsaved callback reload từ DB để consistency.
        setLocalPos((prev) => {
          const next = { ...prev };
          delete next[tableId];
          return next;
        });
        onSaved?.();
      } catch (err) {
        // Rollback local nếu save fail (quay về vị trí cũ từ tables prop).
        setLocalPos((prev) => {
          const next = { ...prev };
          delete next[tableId];
          return next;
        });
        toast({
          title: "Không lưu được vị trí bàn",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      } finally {
        setSavingId(null);
      }
    },
    [drag, snap, onSaved, toast],
  );

  // Cleanup pointer capture khi component unmount giữa drag
  useEffect(() => {
    return () => setDrag(null);
  }, []);

  return (
    <div
      ref={canvasRef}
      className="relative w-full h-[640px] rounded-xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden select-none"
      style={{
        backgroundImage:
          "linear-gradient(rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.18) 1px, transparent 1px)",
        backgroundSize: `${SNAP}px ${SNAP}px`,
        touchAction: "none", // Cho phép drag không bị browser scroll lại
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {positionedTables.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2">
          <Icon name="table_restaurant" size={40} className="opacity-40" />
          <p className="text-sm">Chưa có bàn ở khu vực này</p>
          <p className="text-xs">Thêm bàn ở tab Danh sách</p>
        </div>
      )}

      {positionedTables.map((table) => (
        <DraggableTable
          key={table.id}
          table={table}
          dragging={drag?.tableId === table.id}
          saving={savingId === table.id}
          onPointerDown={(e) => onPointerDown(e, table)}
        />
      ))}

      {/* Hint */}
      <div className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-surface-container/95 backdrop-blur-sm text-xs text-on-surface-variant border border-outline-variant/30 pointer-events-none">
        <Icon name="drag_indicator" size={14} className="inline mr-1 align-text-bottom" />
        Kéo bàn để di chuyển · Snap {SNAP}px
      </div>
    </div>
  );
}

// ── Draggable table ──

function DraggableTable({
  table,
  dragging,
  saving,
  onPointerDown,
}: {
  table: RestaurantTable & { x: number; y: number };
  dragging: boolean;
  saving: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const { w, h } = tableSize(table.capacity);
  const shape = deriveShape(table.capacity);

  // Shape styling
  const shapeClass = (() => {
    switch (shape) {
      case "round":
        return "rounded-full";
      case "long":
        return "rounded-xl";
      case "sofa":
        return "rounded-2xl";
      case "square":
      default:
        return "rounded-lg";
    }
  })();

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      className={cn(
        "absolute flex flex-col items-center justify-center bg-primary-fixed text-primary border-2 border-primary/30 cursor-grab active:cursor-grabbing transition-shadow",
        shapeClass,
        dragging && "ambient-shadow-floating z-20 scale-105 cursor-grabbing",
        saving && "opacity-70",
      )}
      style={{
        left: table.x,
        top: table.y,
        width: w,
        height: h,
      }}
      title={`Bàn ${table.name} (${table.capacity} chỗ) — kéo để di chuyển`}
    >
      <div className="font-black text-base leading-none">{table.tableNumber}</div>
      <div className="text-[10px] mt-0.5 max-w-full truncate px-1">{table.name}</div>
      <div className="text-[9px] mt-0.5 flex items-center gap-0.5 opacity-80">
        <Icon name="group" size={10} />
        <span>{table.capacity}</span>
      </div>
      {saving && (
        <Icon
          name="progress_activity"
          size={14}
          className="absolute -top-1 -right-1 animate-spin text-primary bg-surface-container-lowest rounded-full"
        />
      )}
    </button>
  );
}
