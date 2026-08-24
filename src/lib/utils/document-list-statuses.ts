/**
 * Trạng thái mặc định của các danh sách chứng từ.
 *
 * "Tất cả" ở màn vận hành nghĩa là tất cả chứng từ CÒN HIỆU LỰC. Chứng từ
 * đã hủy chỉ xuất hiện khi người dùng chọn rõ trạng thái "Đã hủy". Giữ các
 * tập này ở một chỗ để bảng, KPI và thao tác xóa bộ lọc không lệch nhau.
 */
export const DEFAULT_INVOICE_LIST_STATUSES = [
  "confirmed",
  "draft",
  "completed",
] as const;

export const DEFAULT_ORDER_LIST_STATUSES = [
  "draft",
  "new",
  "confirmed",
  "delivering",
  "completed",
] as const;

/** Tránh dùng tham chiếu mảng chung làm state React. */
export function copyDefaultStatuses(statuses: readonly string[]): string[] {
  return [...statuses];
}

/** So tập trạng thái, không phụ thuộc thứ tự tick trong bộ lọc. */
export function isDefaultStatusSelection(
  selected: readonly string[],
  defaults: readonly string[],
): boolean {
  return (
    selected.length === defaults.length &&
    defaults.every((status) => selected.includes(status))
  );
}

/** Không để thao tác bỏ tick cuối cùng vô tình làm hiện cả chứng từ đã hủy. */
export function keepVisibleStatusSelection(
  selected: readonly string[],
  defaults: readonly string[],
): string[] {
  return selected.length > 0 ? [...selected] : copyDefaultStatuses(defaults);
}
