"use client";

/**
 * Canvas Konva render sơ đồ bàn.
 * Shared cho Editor (edit mode) + View (cashier xem).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Stage, Layer, Group, Rect, Circle, Text, Line, Image as KonvaImage, Transformer } from "react-konva";
import useImage from "use-image";
import type Konva from "konva";
import type { TableLayout, FloorPlanZone, TableShape } from "@/lib/services/supabase/floor-plan";
import type { FloorPlanDecoration } from "@/lib/services/supabase/floor-plan-decorations";
import { STATUS_COLOR } from "./floor-plan-shapes";
import { getDecorationPreset } from "./decoration-shapes";

export interface CanvasTable extends TableLayout {
  tableNumber?: number;
  name?: string;
  capacity?: number;
  status?: "available" | "occupied" | "reserved" | "cleaning";
  elapsedMinutes?: number;
}

interface FloorPlanCanvasProps {
  zone: FloorPlanZone;
  tables: CanvasTable[];
  /** Đồ trang trí (Phase B). */
  decorations?: FloorPlanDecoration[];
  /** Editor mode: cho phép drag + resize + rotate. View mode: chỉ tap. */
  mode: "edit" | "view";
  /** Tap bàn (view mode = chọn bàn ghi đơn). */
  onSelectTable?: (table: CanvasTable) => void;
  /** Editor: update layout 1 bàn (debounced). */
  onTableLayoutChange?: (id: string, patch: Partial<TableLayout>) => void;
  /** Editor: update decoration. */
  onDecorationChange?: (id: string, patch: Partial<FloorPlanDecoration>) => void;
  /** Editor: chọn bàn để show Transformer + thanh thuộc tính. */
  selectedTableId?: string | null;
  onSelectedTableIdChange?: (id: string | null) => void;
  /** Editor: chọn decoration. */
  selectedDecorationId?: string | null;
  onSelectedDecorationIdChange?: (id: string | null) => void;
  /** Container width (responsive). Stage tự scale theo. */
  containerWidth?: number;
}

export function FloorPlanCanvas({
  zone,
  tables,
  decorations = [],
  mode,
  onSelectTable,
  onTableLayoutChange,
  onDecorationChange,
  selectedTableId,
  onSelectedTableIdChange,
  selectedDecorationId,
  onSelectedDecorationIdChange,
  containerWidth,
}: FloorPlanCanvasProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const [bgImage] = useImage(zone.backgroundUrl ?? "", "anonymous");

  // Scale stage theo containerWidth (responsive)
  const scale = containerWidth
    ? Math.min(1, containerWidth / zone.canvasWidth)
    : 1;
  const stageW = zone.canvasWidth * scale;
  const stageH = zone.canvasHeight * scale;

  // Gắn Transformer vào bàn/decoration đang chọn
  useEffect(() => {
    if (mode !== "edit") return;
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const targetId = selectedTableId
      ? `#table-${selectedTableId}`
      : selectedDecorationId
        ? `#decor-${selectedDecorationId}`
        : null;
    if (!targetId) {
      tr.nodes([]);
      return;
    }
    const node = stage.findOne(targetId);
    if (node) tr.nodes([node]);
    else tr.nodes([]);
  }, [selectedTableId, selectedDecorationId, mode, tables, decorations]);

  // Snap helper
  const snap = useCallback(
    (v: number) => {
      if (!zone.gridSize || zone.gridSize === 0) return v;
      return Math.round(v / zone.gridSize) * zone.gridSize;
    },
    [zone.gridSize],
  );

  const handleDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const x = snap(node.x());
    const y = snap(node.y());
    node.x(x);
    node.y(y);
    onTableLayoutChange?.(id, { positionX: x, positionY: y });
  };

  const handleTransformEnd = (id: string, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const newWidth = Math.max(40, node.width() * scaleX);
    const newHeight = Math.max(40, node.height() * scaleY);
    node.scaleX(1);
    node.scaleY(1);
    onTableLayoutChange?.(id, {
      width: newWidth,
      height: newHeight,
      rotation: node.rotation(),
      positionX: snap(node.x()),
      positionY: snap(node.y()),
    });
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // Click vào nền → bỏ chọn
    if (e.target === e.target.getStage()) {
      onSelectedTableIdChange?.(null);
      onSelectedDecorationIdChange?.(null);
    }
  };

  const handleDecorDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const x = snap(node.x());
    const y = snap(node.y());
    node.x(x);
    node.y(y);
    onDecorationChange?.(id, { positionX: x, positionY: y });
  };

  const handleDecorTransformEnd = (id: string, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const newWidth = Math.max(20, node.width() * scaleX);
    const newHeight = Math.max(20, node.height() * scaleY);
    node.scaleX(1);
    node.scaleY(1);
    onDecorationChange?.(id, {
      width: newWidth,
      height: newHeight,
      rotation: node.rotation(),
      positionX: snap(node.x()),
      positionY: snap(node.y()),
    });
  };

  return (
    <div className="relative bg-surface-container-low rounded-lg overflow-hidden" style={{ width: stageW, height: stageH }}>
      <Stage
        ref={stageRef}
        width={stageW}
        height={stageH}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={handleStageClick}
        onTouchStart={handleStageClick}
      >
        {/* Layer 1: background image + grid + overlay */}
        <Layer listening={false}>
          {bgImage && (
            <KonvaImage
              image={bgImage}
              width={zone.canvasWidth}
              height={zone.canvasHeight}
              opacity={zone.backgroundOpacity / 100}
            />
          )}
          {mode === "edit" && zone.gridSize > 0 && (
            <Grid width={zone.canvasWidth} height={zone.canvasHeight} step={zone.gridSize} />
          )}
          {zone.overlayColor && (
            <Rect
              x={0}
              y={0}
              width={zone.canvasWidth}
              height={zone.canvasHeight}
              fill={zone.overlayColor}
              opacity={0.1}
            />
          )}
        </Layer>

        {/* Layer 1.5: decorations (dưới bàn) */}
        <Layer>
          {decorations.map((d) => (
            <DecorationNode
              key={d.id}
              decoration={d}
              mode={mode}
              isSelected={selectedDecorationId === d.id}
              onSelect={() => {
                if (mode === "edit") {
                  onSelectedDecorationIdChange?.(d.id);
                  onSelectedTableIdChange?.(null);
                }
              }}
              onDragEnd={(e) => handleDecorDragEnd(d.id, e)}
              onTransformEnd={(e) => handleDecorTransformEnd(d.id, e)}
            />
          ))}
        </Layer>

        {/* Layer 2: tables (interactive) */}
        <Layer>
          {tables.map((t) => (
            <TableNode
              key={t.id}
              table={t}
              mode={mode}
              isSelected={selectedTableId === t.id}
              onSelect={() => {
                if (mode === "view") onSelectTable?.(t);
                else onSelectedTableIdChange?.(t.id);
              }}
              onDragEnd={(e) => handleDragEnd(t.id, e)}
              onTransformEnd={(e) => handleTransformEnd(t.id, e)}
            />
          ))}
          {mode === "edit" && (
            <Transformer
              ref={transformerRef}
              rotateEnabled={true}
              keepRatio={false}
              boundBoxFunc={(_, newBox) => {
                if (newBox.width < 40 || newBox.height < 40) return _;
                return newBox;
              }}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}

// ─── Grid background ───
function Grid({ width, height, step }: { width: number; height: number; step: number }) {
  const lines: { points: number[] }[] = [];
  for (let x = 0; x <= width; x += step) lines.push({ points: [x, 0, x, height] });
  for (let y = 0; y <= height; y += step) lines.push({ points: [0, y, width, y] });
  return (
    <>
      {lines.map((l, i) => (
        <Line key={i} points={l.points} stroke="#e5e7eb" strokeWidth={0.5} listening={false} />
      ))}
    </>
  );
}

// ─── Table node (Konva Group) ───
function TableNode({
  table,
  mode,
  isSelected,
  onSelect,
  onDragEnd,
  onTransformEnd,
}: {
  table: CanvasTable;
  mode: "edit" | "view";
  isSelected: boolean;
  onSelect: () => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}) {
  const draggable = mode === "edit" && !table.locked;
  const status = table.status ?? "available";
  const fill = table.color ?? STATUS_COLOR[status];
  const stroke = isSelected ? "#1f2937" : darken(fill, 0.2);

  return (
    <Group
      id={`table-${table.id}`}
      x={table.positionX}
      y={table.positionY}
      rotation={table.rotation}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
      width={table.width}
      height={table.height}
    >
      <ShapeRect table={table} fill={fill} stroke={stroke} />
      {/* Tên bàn */}
      <Text
        text={String(table.tableNumber ?? "")}
        fontSize={Math.min(table.width, table.height) / 3}
        fontStyle="bold"
        fill="#ffffff"
        width={table.width}
        height={table.height}
        align="center"
        verticalAlign="middle"
        listening={false}
      />
      {/* Capacity badge */}
      {table.capacity ? (
        <Text
          text={`${table.capacity} ghế`}
          fontSize={10}
          fill="#ffffff"
          x={4}
          y={table.height - 14}
          listening={false}
        />
      ) : null}
      {/* Timer occupied */}
      {table.status === "occupied" && table.elapsedMinutes !== undefined ? (
        <Text
          text={formatMin(table.elapsedMinutes)}
          fontSize={10}
          fill="#ffffff"
          x={table.width - 32}
          y={4}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

function ShapeRect({
  table,
  fill,
  stroke,
}: {
  table: CanvasTable;
  fill: string;
  stroke: string;
}) {
  const w = table.width;
  const h = table.height;
  const shape: TableShape = table.shape;

  if (shape === "round") {
    return (
      <Circle
        x={w / 2}
        y={h / 2}
        radius={Math.min(w, h) / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
      />
    );
  }
  if (shape === "sofa") {
    // L-shape sofa: 2 rect ghép
    return (
      <>
        <Rect x={0} y={0} width={w} height={h * 0.45} fill={fill} stroke={stroke} strokeWidth={2} cornerRadius={8} />
        <Rect x={0} y={h * 0.5} width={w * 0.55} height={h * 0.5} fill={fill} stroke={stroke} strokeWidth={2} cornerRadius={8} />
      </>
    );
  }
  if (shape === "booth") {
    return (
      <Rect x={0} y={0} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={3} cornerRadius={[16, 16, 4, 4]} />
    );
  }
  // square / rect / bar-seat
  return (
    <Rect x={0} y={0} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={2} cornerRadius={6} />
  );
}

// ─── Helpers ───

// ─── Decoration node ───
function DecorationNode({
  decoration,
  mode,
  isSelected,
  onSelect,
  onDragEnd,
  onTransformEnd,
}: {
  decoration: FloorPlanDecoration;
  mode: "edit" | "view";
  isSelected: boolean;
  onSelect: () => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}) {
  const preset = getDecorationPreset(decoration.kind);
  const fill = decoration.color ?? preset.color;
  const stroke = isSelected ? "#1f2937" : darken(fill, 0.2);
  const draggable = mode === "edit" && !decoration.locked;
  const w = decoration.width;
  const h = decoration.height;

  return (
    <Group
      id={`decor-${decoration.id}`}
      x={decoration.positionX}
      y={decoration.positionY}
      rotation={decoration.rotation}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
      width={w}
      height={h}
    >
      {/* Shape theo kind */}
      {decoration.kind === "plant" ? (
        <Circle x={w / 2} y={h / 2} radius={Math.min(w, h) / 2} fill={fill} stroke={stroke} strokeWidth={1.5} />
      ) : decoration.kind === "door" || decoration.kind === "window" ? (
        <Rect x={0} y={0} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={1} cornerRadius={2} />
      ) : (
        <Rect x={0} y={0} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={1.5} cornerRadius={4} opacity={0.85} />
      )}
      {/* Label */}
      {decoration.label && (
        <Text
          text={decoration.label}
          fontSize={11}
          fill="#ffffff"
          width={w}
          height={h}
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      )}
    </Group>
  );
}

function darken(hex: string, amt: number): string {
  try {
    const c = hex.replace("#", "");
    const r = Math.max(0, parseInt(c.slice(0, 2), 16) - amt * 255);
    const g = Math.max(0, parseInt(c.slice(2, 4), 16) - amt * 255);
    const b = Math.max(0, parseInt(c.slice(4, 6), 16) - amt * 255);
    return `#${Math.round(r).toString(16).padStart(2, "0")}${Math.round(g)
      .toString(16)
      .padStart(2, "0")}${Math.round(b).toString(16).padStart(2, "0")}`;
  } catch {
    return hex;
  }
}

function formatMin(m: number): string {
  if (m < 60) return `${m}'`;
  return `${Math.floor(m / 60)}h${m % 60}'`;
}
