"use client";

/**
 * Canvas Konva render sơ đồ bàn.
 * Shared cho Editor (edit mode) + View (cashier xem).
 */

import { useEffect, useRef, useCallback } from "react";
import { Stage, Layer, Group, Rect, Circle, Text, Line, Image as KonvaImage, Transformer, Shape } from "react-konva";
import useImage from "use-image";
import type Konva from "konva";
import type { TableLayout, FloorPlanZone, TableShape } from "@/lib/services/supabase/floor-plan";
import type { FloorPlanDecoration } from "@/lib/services/supabase/floor-plan-decorations";
import { STATUS_FILL, STATUS_STROKE, STATUS_TEXT, STATUS_DASH } from "./floor-plan-shapes";
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
              opacity={0.35}
              listening={false}
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
  // Normalize status: "cleaning" hoặc undefined → "available" (CEO chốt 3 trạng thái).
  const rawStatus = table.status ?? "available";
  const statusKey = (STATUS_FILL[rawStatus] !== undefined
    ? rawStatus
    : "available") as "available" | "occupied" | "reserved";

  const fill = table.color ?? STATUS_FILL[statusKey];
  const stroke = isSelected ? "#1f2937" : STATUS_STROKE[statusKey];
  const textColor = STATUS_TEXT[statusKey];
  const dash = STATUS_DASH[statusKey];
  // Viền dày hơn cho "đặt trước" để chú ý hơn
  const strokeWidth = statusKey === "reserved" ? 2.5 : 2;

  // Font số bàn: scale theo cạnh nhỏ — không nhồi chữ ngoài shape
  const minSide = Math.min(table.width, table.height);
  const numberFontSize = Math.max(14, Math.min(minSide / 2.5, 36));
  // Nhãn phụ (tên bàn ngắn) chỉ hiện khi đủ chỗ + khác số
  const showName =
    !!table.name &&
    table.name !== String(table.tableNumber ?? "") &&
    minSide >= 80;

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
      <ShapeRect
        table={table}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={dash}
      />
      {/* Số bàn — to, đậm, giữa. Màu chữ đối lập với fill. */}
      <Text
        text={String(table.tableNumber ?? "")}
        fontSize={numberFontSize}
        fontStyle="bold"
        fontFamily="Inter, system-ui, sans-serif"
        fill={textColor}
        width={table.width}
        height={table.height}
        align="center"
        verticalAlign="middle"
        listening={false}
      />
      {/* Tên ngắn dưới số bàn — chỉ khi đủ chỗ */}
      {showName && (
        <Text
          text={table.name!}
          fontSize={Math.max(9, minSide / 9)}
          fill={statusKey === "occupied" ? "rgba(255,255,255,0.85)" : "#6b7280"}
          width={table.width}
          y={table.height / 2 + numberFontSize / 2}
          align="center"
          listening={false}
        />
      )}
    </Group>
  );
}

function ShapeRect({
  table,
  fill,
  stroke,
  strokeWidth,
  dash,
}: {
  table: CanvasTable;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash: number[] | undefined;
}) {
  const w = table.width;
  const h = table.height;
  const shape: TableShape = table.shape;
  // Shadow nhẹ — bàn không cảm giác cứng đơ, nhưng không quá nặng làm nhiễu
  const shadowProps = {
    shadowColor: "rgba(15, 23, 42, 0.12)",
    shadowBlur: 5,
    shadowOffsetY: 2,
    shadowOpacity: 1,
  } as const;

  if (shape === "round") {
    return (
      <Circle
        x={w / 2}
        y={h / 2}
        radius={Math.min(w, h) / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={dash}
        {...shadowProps}
      />
    );
  }
  if (shape === "sofa") {
    // Sofa góc L-shape — vẽ custom để có viền liền + lưng tựa rõ
    const back = Math.max(8, Math.min(w, h) * 0.18);
    return (
      <Shape
        sceneFunc={(ctx, sh) => {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(w, 0);
          ctx.lineTo(w, h * 0.55);
          ctx.lineTo(w * 0.55, h * 0.55);
          ctx.lineTo(w * 0.55, h);
          ctx.lineTo(0, h);
          ctx.closePath();
          ctx.fillStrokeShape(sh);
          // Lưng tựa — dải đậm hơn dọc theo cạnh ngoài
          ctx.fillStyle = "rgba(0,0,0,0.12)";
          ctx.fillRect(0, 0, w, back);
          ctx.fillRect(0, 0, back, h);
        }}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={dash}
        {...shadowProps}
      />
    );
  }
  if (shape === "booth") {
    return (
      <Rect
        x={0}
        y={0}
        width={w}
        height={h}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        cornerRadius={[16, 16, 4, 4]}
        dash={dash}
        {...shadowProps}
      />
    );
  }
  // square / rect / bar-seat
  return (
    <Rect
      x={0}
      y={0}
      width={w}
      height={h}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      cornerRadius={8}
      dash={dash}
      {...shadowProps}
    />
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
  const minSide = Math.min(w, h);

  // Label: chỉ hiện khi đủ chỗ (vd: tường + cửa sổ dài mỏng không nhồi text)
  const showLabel = !!decoration.label && minSide >= 24;
  const labelFontSize = Math.max(9, Math.min(minSide / 4, 12));

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
      <DecorShape decoration={decoration} fill={fill} stroke={stroke} />
      {showLabel && (
        <Text
          text={decoration.label!}
          fontSize={labelFontSize}
          fontStyle="600"
          fill="#ffffff"
          width={w}
          height={h}
          align="center"
          verticalAlign="middle"
          listening={false}
          shadowColor="rgba(0,0,0,0.35)"
          shadowBlur={2}
          shadowOffsetY={1}
        />
      )}
    </Group>
  );
}

/**
 * Vẽ shape riêng cho từng loại đồ trang trí.
 * — plant: chậu cây 3 lá + thân chậu (custom sceneFunc)
 * — door: cánh cửa nâu + cung mở
 * — window: khung kính trong suốt + 1 chia dọc
 * — bar: bo góc + 2 đường gỗ
 * — restroom: rect tròn góc lớn (ô vuông màu)
 * — stairs: rect + 3 vạch ngang (bậc thang)
 * — tv: dải đen mảnh
 * — wall: dải đậm
 */
function DecorShape({
  decoration,
  fill,
  stroke,
}: {
  decoration: FloorPlanDecoration;
  fill: string;
  stroke: string;
}) {
  const w = decoration.width;
  const h = decoration.height;
  const kind = decoration.kind;

  if (kind === "plant") {
    // 3 lá xanh + chậu nâu — vẽ bằng sceneFunc cho liền mạch
    return (
      <Shape
        sceneFunc={(ctx, sh) => {
          const cx = w / 2;
          const cy = h / 2;
          const r = Math.min(w, h) / 2;
          // Chậu (1/3 dưới)
          ctx.fillStyle = "#92400e";
          ctx.fillRect(cx - r * 0.55, cy + r * 0.25, r * 1.1, r * 0.7);
          // 3 lá hình ellipse xếp lệch — toạ độ tương đối
          ctx.fillStyle = fill;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1;
          // Lá giữa to
          ctx.beginPath();
          ctx.ellipse(cx, cy - r * 0.15, r * 0.45, r * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Lá trái
          ctx.beginPath();
          ctx.ellipse(cx - r * 0.4, cy, r * 0.35, r * 0.55, -0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Lá phải
          ctx.beginPath();
          ctx.ellipse(cx + r * 0.4, cy, r * 0.35, r * 0.55, 0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Gân lá giữa
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.beginPath();
          ctx.moveTo(cx, cy - r * 0.7);
          ctx.lineTo(cx, cy + r * 0.45);
          ctx.stroke();
          sh.getLayer();
        }}
      />
    );
  }

  if (kind === "door") {
    // Cánh cửa + cung mở 90°
    return (
      <Shape
        sceneFunc={(ctx, sh) => {
          ctx.fillStyle = fill;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.5;
          // Cánh cửa (thân chính)
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.fill();
          ctx.stroke();
          // Cung mở (1/4 cung tròn)
          ctx.strokeStyle = "rgba(0,0,0,0.4)";
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(0, h, Math.min(w, h * 3), -Math.PI / 2, 0);
          ctx.stroke();
          ctx.setLineDash([]);
          sh.getLayer();
        }}
      />
    );
  }

  if (kind === "window") {
    // Khung kính: viền đậm + chia dọc giữa
    return (
      <Shape
        sceneFunc={(ctx, sh) => {
          ctx.fillStyle = fill;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.fill();
          ctx.stroke();
          // Chia dọc + ngang
          ctx.beginPath();
          ctx.moveTo(w / 2, 0);
          ctx.lineTo(w / 2, h);
          ctx.stroke();
          sh.getLayer();
        }}
      />
    );
  }

  if (kind === "stairs") {
    // Khung + 4 vạch ngang (bậc)
    return (
      <Shape
        sceneFunc={(ctx, sh) => {
          ctx.fillStyle = fill;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255,0.55)";
          ctx.lineWidth = 1;
          for (let i = 1; i < 5; i++) {
            ctx.beginPath();
            ctx.moveTo(0, (h / 5) * i);
            ctx.lineTo(w, (h / 5) * i);
            ctx.stroke();
          }
          sh.getLayer();
        }}
      />
    );
  }

  // Mặc định: rect bo góc (bar, restroom, tv, wall, custom)
  const radius = kind === "wall" || kind === "tv" ? 2 : 6;
  return (
    <Rect
      x={0}
      y={0}
      width={w}
      height={h}
      fill={fill}
      stroke={stroke}
      strokeWidth={1.5}
      cornerRadius={radius}
      opacity={0.92}
    />
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

