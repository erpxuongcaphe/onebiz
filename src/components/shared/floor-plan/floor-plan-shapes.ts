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
  // Tròn 2 / 4 / 6 ghế — chuẩn hoá size để khỏi to lệch nhau quá
  { key: "round-2", shape: "round", label: "Tròn 2", icon: "circle", width: 60, height: 60, seats: 2 },
  { key: "round-4", shape: "round", label: "Tròn 4", icon: "circle", width: 80, height: 80, seats: 4 },
  { key: "round-6", shape: "round", label: "Tròn 6", icon: "circle", width: 100, height: 100, seats: 6 },
  // Vuông
  { key: "square-2", shape: "square", label: "Vuông 2", icon: "square", width: 60, height: 60, seats: 2 },
  { key: "square-4", shape: "square", label: "Vuông 4", icon: "square", width: 80, height: 80, seats: 4 },
  // Dài
  { key: "rect-4", shape: "rect", label: "Dài 4", icon: "rectangle", width: 140, height: 60, seats: 4 },
  { key: "rect-6", shape: "rect", label: "Dài 6", icon: "rectangle", width: 180, height: 70, seats: 6 },
  // Sofa góc — L-shape
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

/**
 * Bảng màu trạng thái — chuẩn theo Toast / OpenTable.
 * - available: xanh ngọc (đèn xanh = trống = mời vào)
 * - occupied:  cam      (đang phục vụ — nổi bật)
 * - reserved:  xanh dương + nét đứt (đã đặt trước, chưa tới)
 * - cleaning:  xám      (đang dọn, không tiếp khách)
 */
export const STATUS_COLOR: Record<string, string> = {
  available: "#10b981",
  occupied: "#f59e0b",
  reserved: "#3b82f6",
  cleaning: "#9ca3af",
};

/** Viền tối hơn nền 1 chút — dùng cho border bàn. */
export const STATUS_STROKE: Record<string, string> = {
  available: "#059669",
  occupied: "#d97706",
  reserved: "#2563eb",
  cleaning: "#6b7280",
};
