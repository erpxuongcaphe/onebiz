import { z } from "zod";

export const systemRoleRequest = z.object({
  userId: z.string().uuid(),
  expectedRole: z.string().min(1).max(32),
  makeOwner: z.boolean(),
  reason: z.string().trim().min(5).max(1000),
  confirmation: z.string().trim().min(1).max(320),
  requestId: z.string().uuid(),
}).strict();

export function systemRoleError(code?: string): { status: number; message: string } {
  const errors: Record<string, { status: number; message: string }> = {
    ROLE_AUTH_REQUIRED: { status: 401, message: "Vui lòng đăng nhập lại." },
    ROLE_OWNER_REQUIRED: { status: 403, message: "Chỉ quản trị toàn doanh nghiệp đang hoạt động được đổi quyền này." },
    ROLE_TARGET_NOT_FOUND: { status: 403, message: "Không tìm thấy tài khoản trong doanh nghiệp của bạn." },
    ROLE_SELF_CHANGE: { status: 403, message: "Không được tự thay đổi quyền quản trị của mình." },
    ROLE_TARGET_INACTIVE: { status: 409, message: "Kích hoạt tài khoản trước khi cấp quyền quản trị." },
    ROLE_STALE: { status: 409, message: "Quyền tài khoản đã thay đổi. Tải lại danh sách trước khi tiếp tục." },
    ROLE_LAST_OWNER: { status: 409, message: "Phải giữ ít nhất một quản trị toàn doanh nghiệp đang hoạt động." },
    ROLE_REQUEST_CONFLICT: { status: 409, message: "Yêu cầu đã được dùng cho thao tác khác. Đóng và mở lại cửa sổ." },
    ROLE_CONFIRMATION: { status: 400, message: "Email xác nhận không khớp tài khoản được chọn." },
    ROLE_INVALID_REQUEST: { status: 400, message: "Thông tin chưa hợp lệ. Cần lý do từ 5 đến 1,000 ký tự." },
  };
  return errors[code ?? ""] ?? { status: 500, message: "Chưa đổi được quyền quản trị. Vui lòng thử lại; không gửi liên tục." };
}
