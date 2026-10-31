/** Only confirmed server rejections are safe to describe as a failed split. */
const messages: Record<string, string> = {
  DELIVERY_ORDER_CANNOT_SPLIT: "Đơn qua đối tác hoặc có hoa hồng chưa hỗ trợ tách bill. Giữ nguyên đơn để đối soát; đơn quán tự giao có thể tách.",
  KITCHEN_ORDER_NOT_SPLITTABLE: "Bill đã thanh toán, hủy, gộp hoặc giao xong nên không thể tách. Tải lại danh sách đơn để kiểm tra.",
  KITCHEN_ORDER_NOT_FOUND: "Không tìm thấy bill trong chi nhánh hiện tại. Tải lại danh sách đơn.",
  SPLIT_BILL_PERMISSION_REQUIRED: "Tài khoản chưa có quyền tách bill. Nhờ quản lý kiểm tra quyền.",
  BRANCH_ACCESS_DENIED: "Tài khoản chưa có quyền thao tác tại chi nhánh của bill này.",
  ACTIVE_PROFILE_REQUIRED: "Phiên làm việc không còn hợp lệ. Kiểm tra lại tài khoản đang đăng nhập.",
  AUTH_REQUIRED: "Cần đăng nhập để tách bill.",
  SPLIT_QUANTITY_CHANGED: "Số lượng món vừa thay đổi. Đóng màn tách, tải lại bill rồi chọn lại.",
  SPLIT_QUANTITY_INVALID: "Nhập số lượng nguyên từ 1 đến số món còn lại trên bill.",
  SPLIT_ITEM_NOT_IN_ORDER: "Món đã chuyển khỏi bill. Tải lại bill trước khi tách.",
  SPLIT_PARENT_EMPTY: "Giữ lại ít nhất 1 món trên bill đang mở.",
  SPLIT_ITEM_SELECTION_INVALID: "Chọn lại món muốn chuyển; giữ lại ít nhất 1 món trên bill đang mở.",
  SPLIT_ITEM_DUPLICATE: "Một món bị chọn trùng. Đóng màn tách rồi chọn lại.",
  NOT_ENOUGH_ITEMS_TO_SPLIT: "Không đủ dòng món để chia nhiều bill. Dùng Tách theo món để chọn số lượng.",
  SPLIT_WAYS_INVALID: "Chọn số bill từ 2 đến 10 và không vượt số dòng món.",
  SPLIT_CONCURRENT_CHANGE: "Bill vừa thay đổi trên máy khác. Tải lại danh sách đơn để kiểm tra trước khi tách tiếp.",
  SPLIT_REQUEST_CHANGED: "Yêu cầu này đã dùng cho nội dung khác. Kiểm tra các bill trước khi thử lại.",
  ORDER_DISCOUNT_INVALID: "Giảm giá vượt giá trị món còn lại. Kiểm tra giảm giá của bill trước khi tách.",
};

export const SPLIT_UNCONFIRMED = "Chưa xác nhận được kết quả tách bill. Kiểm tra danh sách đơn trước khi thử lại.";

export class SplitBillRejection extends Error {}

export function splitBillFailure(error: { message: string; code?: string }): Error {
  const message = messages[error.message];
  return message ? new SplitBillRejection(message) : new Error(SPLIT_UNCONFIRMED);
}

export function splitBillErrorMessage(error: unknown): string {
  return error instanceof SplitBillRejection ? error.message : SPLIT_UNCONFIRMED;
}
