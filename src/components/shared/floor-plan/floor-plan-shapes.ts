/**
 * Mẫu bàn pre-built cho Floor Plan Editor.
 * 8 shape phổ biến quán cà phê + nhà hàng.
 * CEO 04/06/2026 — Sprint 5.
 */

import type { TableShape } from "@/lib/services/supabase/floor-plan";

export interface ShapePreset {
  /** Định danh nội bộ — không hiển thị. */
  key: string;
  /** Mẫu hình học (round/square/rect/sofa/booth/bar-seat). */
  shape: TableShape;
  /** Tên hiển thị tiếng Việt. */
  label: string;
  /** Icon Material Symbols. */
  icon: string;
  /** Kích thước mặc định (px trên canvas 1024). */
  width: number;
  height: number;
  /** Số ghế gợi ý (capacity). */
  seats: number;
}

export const SHAPE_PRESETS: ShapePreset[] = [
  // Tròn 2 / 4 / 6 ghế
  { key: "round-2", shape: "round", label: "Tròn 2", icon: "circle", width: 60, height: 60, seats: 2 },
  { key: "round-4", shape: "round", label: "Tròn 4", icon: "circle", width: 90, height: 90, seats: 4 },
  { key: "round-6", shape: "round", label: "Tròn 6", icon: "circle", width: 120, height: 120, seats: 6 },
  // Vuông
  { key: "square-2", shape: "square", label: "Vuông 2", icon: "square", width: 60, height: 60, seats: 2 },
  { key: "square-4", shape: "square", label: "Vuông 4", icon: "square", width: 90, height: 90, seats: 4 },
  // Dài
  { key: "rect-4", shape: "rect", label: "Dài 4", icon: "rectangle", width: 140, height: 60, seats: 4 },
  { key: "rect-6", shape: "rect", label: "Dài 6", icon: "rectangle", width: 180, height: 70, seats: 6 },
  // Sofa
  { key: "sofa", shape: "sofa", label: "Sofa góc", icon: "weekend", width: 160, height: 120, seats: 6 },
];

export function getShapePreset(key: string): ShapePreset | undefined {
  return SHAPE_PRESETS.find((p) => p.key === key);
}

export function getShapeDefaults(shape: TableShape): {
  width: number;
  height: number;
  seats: number;
} {
  const found = SHAPE_PRESETS.find((p) => p.shape === shape);
  return {
    width: found?.width ?? 80,
    height: found?.height ?? 80,
    seats: found?.seats ?? 4,
  };
}

/** Màu mặc định theo trạng thái (cho cả View + Editor). */
export const STATUS_COLOR: Record<string, string> = {
  available: "#10b981",
  occupied: "#3b82f6",
  reserved: "#f59e0b",
  cleaning: "#9ca3af",
};
