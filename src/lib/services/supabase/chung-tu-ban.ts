/**
 * ĐIỀU KIỆN ĐỌC DÙNG CHUNG — tách "chứng từ bán" khỏi "đơn đặt hàng".
 *
 * Bảng `invoices` chứa NHIỀU loại chứng từ. Trang Hóa đơn chỉ được hiện chứng
 * từ bán; đơn đặt hàng (DH) thuộc về trang Đơn đặt hàng, kể cả khi đã xử lý.
 *
 * ── Vì sao KHÔNG lọc bằng `source <> 'order'` ──────────────────────────────
 * Mô hình CŨ hoàn tất đơn TẠI CHỖ: `pos_checkout_v3/v5` (migration 00169 dòng
 * 118-130, 00203 dòng 508) khi hoàn tất sẽ cấp mã HD mới và ghi
 * `order_code := mã cũ`, NHƯNG giữ nguyên `source = 'order'`. Những bản ghi đó
 * là HÓA ĐƠN BÁN THẬT. Preflight production 22/08/2026 đếm được **33 bản ghi**
 * như vậy (31 completed) — lọc bằng `source <> 'order'` sẽ xóa sạch chúng khỏi
 * màn Hóa đơn. Đã đo đối chứng trên production: điều kiện đúng cho 323 dòng,
 * lọc ngây thơ chỉ còn 290 — mất đúng 33.
 *
 * ── Vì sao KHÔNG lọc bằng tiền tố mã "DH" ─────────────────────────────────
 * Tiền tố là dữ liệu hiển thị, không phải khoá phân loại: đổi quy ước cấp mã
 * (đã đổi một lần ở 00169) là bộ lọc hỏng âm thầm. Dùng cột quan hệ thay vì
 * chuỗi.
 *
 * ── Mốc phân loại (đã kiểm chứng trên dữ liệu production) ─────────────────
 *   source = 'order' + order_code IS NULL      → CÒN là đơn đặt hàng  → ẨN
 *   source = 'order' + order_code IS NOT NULL  → đã chuyển tại chỗ    → HIỆN
 *   source ≠ 'order' (kể cả NULL)              → chứng từ POS/FnB/... → HIỆN
 *
 * 5 phép kiểm bất thường của preflight đều = 0, nên hai mốc trên không chồng
 * lấn: không có dòng nào vừa `source='order'` vừa mang `source_order_id`, và
 * không có mã DH nào nằm ngoài `source='order'`.
 *
 * `source` có thể NULL với nháp cũ (xem `listDraftOrders` trong orders.ts) nên
 * mọi so sánh phải AN TOÀN VỚI NULL: trong SQL `source <> 'order'` trả NULL —
 * tức LOẠI — với dòng NULL, nên phải nêu `source.is.null` tường minh.
 */

/** Hình dạng tối thiểu để phân loại — nhận cả row thô lẫn bản đã map. */
export interface DongChungTu {
  source?: string | null;
  order_code?: string | null;
}

/** Giá trị `source` đánh dấu bản ghi là đơn đặt hàng. */
export const SOURCE_DON_DAT_HANG = "order";

/**
 * Bộ lọc PostgREST tương đương `laChungTuBan()`.
 *
 * Ba vế OR (PostgREST nối các vế bằng OR, rồi AND với các filter khác):
 *   1. `source.is.null`            — nháp cũ chưa có source
 *   2. `source.neq.order`          — POS / FnB / online / internal
 *   3. `order_code.not.is.null`    — đơn đã chuyển tại chỗ thành HD
 *
 * ⚠️ Đã thử thật trên production (chỉ đọc) vì repo chưa có tiền lệ dùng
 * `not.is.null` bên trong `.or()`: cú pháp này CHẠY và cho đúng 323 dòng.
 * Dạng `.not("and", "(...)")` thì Supabase trả lỗi rỗng — đừng dùng.
 */
export const LOC_CHUNG_TU_BAN =
  "source.is.null,source.neq.order,order_code.not.is.null";

/**
 * Hàm thuần — dùng cho test và cho mọi phép lọc phía client, để client và máy
 * chủ không bao giờ lệch định nghĩa.
 */
export function laChungTuBan(dong: DongChungTu): boolean {
  if (dong.source !== SOURCE_DON_DAT_HANG) return true;
  return dong.order_code != null && dong.order_code !== "";
}

/** Ngược lại `laChungTuBan` — bản ghi CÒN là đơn đặt hàng. */
export function laDonDatHangConHieuLuc(dong: DongChungTu): boolean {
  return !laChungTuBan(dong);
}

/**
 * Áp điều kiện vào một query PostgREST đang dựng.
 *
 * Dùng hàm này thay vì gõ lại chuỗi lọc ở từng chỗ đọc: bảng, KPI, tổng số,
 * tìm kiếm, lọc trạng thái/ngày/chi nhánh và xuất Excel của trang Hóa đơn đều
 * đi qua CÙNG một truy vấn, nên không thể lệch nhau.
 */
export function apDungLocChungTuBan<T extends { or: (dieu_kien: string) => T }>(
  query: T,
): T {
  return query.or(LOC_CHUNG_TU_BAN);
}
