/**
 * 06/08/2026 — Hai quyết định của POS FnB tách khỏi giao diện (CEO chốt).
 *
 * Vì sao tách ra file riêng: cả hai đều là quy tắc nghiệp vụ ("có cho thanh
 * toán không", "nhóm nào được hiện") nhưng trước đây nằm lẫn trong một trang
 * 3.000 dòng, không kiểm được nếu không dựng cả POS. Tách ra thì test là
 * TEST HÀNH VI thật — cho đầu vào, kiểm đầu ra — chứ không phải đọc chuỗi
 * class trong mã nguồn.
 *
 * KHÔNG có tính tiền, không đụng kho/BOM/đơn bếp ở đây.
 */

/**
 * Trạng thái ca — MỘT nguồn duy nhất cho POS FnB.
 *
 * Bản cũ chỉ có `Shift | null` nên gộp 3 tình huống khác hẳn nhau vào cùng
 * một giá trị `null`: đang kiểm tra / chắc chắn chưa mở ca / KHÔNG kiểm tra
 * được. `.catch(() => null)` khi tải ca biến LỖI MẠNG thành "chưa mở ca".
 */
export type ShiftStatus = "loading" | "open" | "none" | "error";

/**
 * Trạng thái tải danh mục món.
 *
 * Trước đây chỉ có cờ `loading`, và cờ đó TẮT ngay khi cache đổ về — trước
 * cả khi mạng trả kết quả. Vì vậy KHÔNG được dùng `loading === false` làm
 * điều kiện lọc nhóm rỗng. Và cũng chưa hề có trạng thái LỖI.
 */
export type CatalogStatus = "loading" | "cache_ready" | "fresh_ready" | "error";

/** Việc POS phải làm khi nhân viên bấm Thanh toán. */
export type PaymentDecision =
  /** Giỏ rỗng — không làm gì, không phiền người dùng bằng toast. */
  | "khong_lam_gi"
  /** Mở màn thanh toán. */
  | "mo_thanh_toan"
  /** Đang kiểm tra ca — báo chờ một nhịp. */
  | "cho_kiem_tra_ca"
  /** Chắc chắn chưa mở ca — báo + mở popup mở ca. */
  | "yeu_cau_mo_ca"
  /** Không kiểm tra được ca — báo + tự thử lại, KHÔNG kết luận chưa mở ca. */
  | "thu_lai_kiem_ca"
  /**
   * Mất mạng VÀ chưa biết chắc ca đang mở → GIỮ GIỎ, yêu cầu kết nối lại.
   * Không xoá giỏ, không cho thu tiền.
   */
  | "giu_gio_cho_ket_noi";

/**
 * Quyết định duy nhất cho cả 3 lối vào thanh toán (nút desktop, nút giỏ
 * mobile, phím F9). Trước đây mỗi lối gọi thẳng `setPaymentOpen(true)` nên
 * thêm điều kiện là phải sửa 3 nơi và chắc chắn sót một.
 *
 * Hai quy tắc quan trọng:
 *  • OFFLINE CHỈ BÁN KHI ĐÃ BIẾT CHẮC CA ĐANG MỞ (CEO chốt 07/08).
 *    Bản trước của em cho bán offline ở MỌI trạng thái ca — tiền có thể
 *    không vào ca nào. Nay: `open` (đã đọc thành công cho ĐÚNG chi nhánh +
 *    ĐÚNG người, và được giữ lại khi rớt mạng — xem `giuDuocCaDaBiet`) thì
 *    bán bình thường; chưa rõ hoặc lỗi thì GIỮ GIỎ, yêu cầu kết nối lại.
 *  • LỖI ≠ CHƯA MỞ CA. Không kiểm tra được thì thử lại, không bắt nhân viên
 *    mở ca thứ hai chồng lên ca đang mở thật.
 */
export function quyetDinhThanhToan(input: {
  lineCount: number;
  isOnline: boolean;
  shiftStatus: ShiftStatus;
}): PaymentDecision {
  if (input.lineCount <= 0) return "khong_lam_gi";
  if (!input.isOnline) {
    // Mất mạng: chỉ ca ĐÃ BIẾT CHẮC mới được thu tiền. Mọi trạng thái khác
    // đều giữ giỏ — kể cả `none`, vì offline cũng không mở ca mới được.
    return input.shiftStatus === "open"
      ? "mo_thanh_toan"
      : "giu_gio_cho_ket_noi";
  }
  switch (input.shiftStatus) {
    case "open":
      return "mo_thanh_toan";
    case "loading":
      return "cho_kiem_tra_ca";
    case "none":
      return "yeu_cau_mo_ca";
    case "error":
      return "thu_lai_kiem_ca";
  }
}

/**
 * Có được GIỮ lại ca đã biết khi phải kiểm tra lại hay không.
 *
 * Vì sao cần: mỗi lần effect tải ca chạy lại (rớt mạng, bấm thử lại, đổi
 * `isOnline`) mà xoá trạng thái về `loading`/`error` thì `currentShift`
 * thành `null` giữa chừng — trong khi thanh toán ghi `shiftId:
 * currentShift?.id`. Một cú chớp mạng có thể làm phiếu thu KHÔNG gắn vào
 * ca. Bản cũ không xoá; bản mới cũng không được xoá.
 *
 * Nhưng CHỈ giữ khi đúng chi nhánh + đúng người. Đổi chi nhánh mà giữ ca
 * cũ là ghi tiền của quán này vào ca của quán kia.
 */
export function giuDuocCaDaBiet(
  ca: { branchId: string; cashierId: string } | null | undefined,
  branchId: string,
  userId: string,
): boolean {
  if (!ca || !branchId || !userId) return false;
  return ca.branchId === branchId && ca.cashierId === userId;
}

/**
 * Có được phép ẩn nhóm hàng rỗng khỏi cột danh mục hay không.
 *
 * Chỉ khi danh sách món đã đáng tin. Lúc `loading` thì products còn rỗng →
 * lọc sẽ xoá sạch danh mục; lúc `error` thì danh sách không đáng tin → giữ
 * nguyên, thà hiện nhóm rỗng còn hơn giấu mất nhóm thật.
 */
export function duocPhepLocNhomRong(catalogStatus: CatalogStatus): boolean {
  return catalogStatus === "cache_ready" || catalogStatus === "fresh_ready";
}

/**
 * Lọc nhóm rỗng tại ĐÚNG MỘT chỗ — cả 3 nơi tiêu thụ (cột danh mục desktop,
 * thanh danh mục tablet, ngăn kéo mobile) đều đọc kết quả này nên không thể
 * lệch nhau.
 *
 * LUÔN giữ nhóm đang chọn kể cả count 0: nếu không thì nhóm đang mở biến mất
 * khỏi cột trong khi khu món vẫn đang lọc theo chính nhóm đó.
 */
export function locNhomRong<T extends { id: string; count: number }>(
  nhom: T[],
  catalogStatus: CatalogStatus,
  activeCategoryId: string | null,
): T[] {
  if (!duocPhepLocNhomRong(catalogStatus)) return nhom;
  return nhom.filter((c) => c.count > 0 || c.id === activeCategoryId);
}
