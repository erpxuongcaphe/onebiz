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
 *
 * Nguyên tắc: trống = default state = KHÔNG tô fill. Chỉ trạng thái
 * "khác bình thường" mới tô màu nổi bật.
 *
 * - available: fill trắng, viền xanh ngọc — "im lặng" như background
 * - occupied:  fill cam, viền cam đậm   — nổi bật nhất, cần chú ý
 * - reserved:  fill xanh dương nhạt, viền xanh dương nét đứt — cảnh báo "sắp tới"
 *
 * "cleaning" giữ trong type để khỏi vỡ data có sẵn, nhưng UI render fallback
 * sang "available" — cashier dọn xong tự đặt lại "Trống" là đủ.
 */
export const STATUS_FILL: Record<string, string> = {
  available: "#ffffff",
  occupied: "#f59e0b",
  reserved: "#dbeafe",
};

export const STATUS_STROKE: Record<string, string> = {
  available: "#10b981",
  occupied: "#d97706",
  reserved: "#3b82f6",
};

/** Màu chữ số bàn — chọn theo độ tương phản với fill. */
export const STATUS_TEXT: Record<string, string> = {
  available: "#1f2937",
  occupied: "#ffffff",
  reserved: "#1e40af",
};

/** Viền nét đứt cho trạng thái "đặt trước". */
export const STATUS_DASH: Record<string, number[] | undefined> = {
  available: undefined,
  occupied: undefined,
  reserved: [6, 4],
};

/**
 * @deprecated Dùng STATUS_FILL + STATUS_STROKE + STATUS_TEXT.
 * Giữ alias để không vỡ import cũ (POS FnB legacy).
 */
export const STATUS_COLOR: Record<string, string> = STATUS_FILL;
