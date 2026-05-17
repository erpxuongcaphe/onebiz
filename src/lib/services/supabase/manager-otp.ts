/**
 * Manager OTP — duyệt từ xa các action nhạy cảm POS.
 *
 * CEO 12/05/2026: cashier muốn xoá bill / xoá món / giảm giá ngoài phạm vi
 * nhưng quản lý không có mặt tại quán. Manager mở web `onebiz.com.vn/manager`
 * → bấm "Cấp OTP" → service gọi RPC sinh mã 6 số TTL 2 phút → manager đọc
 * qua điện thoại → cashier nhập vào POS để duyệt.
 *
 * 3 RPC chính (migration 00061_manager_otp_codes):
 *   - issue_manager_otp(action_code, target_meta?, branch_id?)
 *   - verify_and_use_manager_otp(code, action_code, target_meta?)
 *   - get_recent_manager_otps(limit?)
 */

import { getClient, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";

// ============================================================
// Action codes — 6 action CEO chốt 12/05
// ============================================================

/**
 * Sprint A.7 (CEO 12/05): tách `crm.delete_party` → 3 action chi tiết.
 * Giữ alias `CRM_DELETE_PARTY` deprecated 2 tuần để client cũ không vỡ;
 * sau đó remove khi tất cả callsite migrated sang code mới.
 */
export const OTP_ACTION_CODES = {
  FNB_CANCEL_UNPAID_BILL: "fnb.cancel_unpaid_bill",
  FNB_CANCEL_UNPAID_ITEM: "fnb.cancel_unpaid_item",
  FNB_DISCOUNT_OVERRIDE: "fnb.discount_override",
  FNB_VOID_PAID_BILL: "fnb.void_paid_bill",
  FNB_EDIT_SENT_ORDER: "fnb.edit_sent_order",
  // A.7: tách rõ entity type
  CRM_DELETE_CUSTOMER: "crm.delete_customer",
  CRM_DELETE_SUPPLIER: "crm.delete_supplier",
  PRODUCTS_DELETE: "products.delete",
  /** @deprecated dùng CRM_DELETE_CUSTOMER hoặc PRODUCTS_DELETE */
  CRM_DELETE_PARTY: "crm.delete_party",
} as const;

export type OtpActionCode =
  (typeof OTP_ACTION_CODES)[keyof typeof OTP_ACTION_CODES];

/** Label tiếng Việt cho UI hiển thị. */
export const OTP_ACTION_LABELS: Record<OtpActionCode, string> = {
  [OTP_ACTION_CODES.FNB_CANCEL_UNPAID_BILL]: "Xoá bill chưa thanh toán",
  [OTP_ACTION_CODES.FNB_CANCEL_UNPAID_ITEM]: "Xoá món chưa thanh toán",
  [OTP_ACTION_CODES.FNB_DISCOUNT_OVERRIDE]: "Giảm giá ngoài phạm vi",
  [OTP_ACTION_CODES.FNB_VOID_PAID_BILL]: "Huỷ bill đã thanh toán",
  [OTP_ACTION_CODES.FNB_EDIT_SENT_ORDER]: "Sửa món đã gửi bếp",
  [OTP_ACTION_CODES.CRM_DELETE_CUSTOMER]: "Xoá khách hàng",
  [OTP_ACTION_CODES.CRM_DELETE_SUPPLIER]: "Xoá nhà cung cấp",
  [OTP_ACTION_CODES.PRODUCTS_DELETE]: "Xoá sản phẩm",
  [OTP_ACTION_CODES.CRM_DELETE_PARTY]: "Xoá khách hàng / NCC (cũ)",
};

// ============================================================
// Types
// ============================================================

export interface IssueManagerOtpInput {
  actionCode: OtpActionCode | string;
  targetMeta?: Record<string, unknown>;
  branchId?: string;
  /** Day 17/05/2026: bind OTP với hoá đơn cụ thể.
   *  Manager nhập mã (cashier đọc qua điện thoại) — server resolve → entity_id.
   *  Áp dụng cho fnb.void_paid_bill + fnb.discount_override. */
  targetInvoiceCode?: string;
  /** Day 17/05/2026: bind OTP với đơn bếp (cancel unpaid). */
  targetKitchenOrderNumber?: string;
}

export interface IssuedOtp {
  otpId: string;
  /** Plain code 6 số — CHỈ trả về lần đầu khi sinh. Tuyệt đối không log. */
  code: string;
  expiresAt: string;
  expiresInSeconds: number;
  actionCode: string;
  issuedByName: string;
  /** True nếu OTP đã gắn target entity (tăng độ an toàn). */
  targetBound?: boolean;
}

export interface VerifyManagerOtpInput {
  code: string;
  actionCode: OtpActionCode | string;
  targetMeta?: Record<string, unknown>;
}

export interface VerifiedOtp {
  otpId: string;
  actionCode: string;
  issuedBy: string;
  issuedByName: string;
  issuedAt: string;
  usedAt: string;
}

export interface RecentManagerOtp {
  id: string;
  actionCode: string;
  actionLabel: string;
  targetMeta: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByName: string | null;
  isExpired: boolean;
  isUsed: boolean;
}

// ============================================================
// Service functions
// ============================================================

/**
 * Manager cấp OTP duyệt từ xa.
 *
 * Server check permission tương ứng action + rate limit 5/15 phút. UI nên
 * hiển thị mã 6 số to + đếm ngược 2 phút, đồng thời cảnh báo "không chụp
 * màn hình / không share ngoài cuộc gọi đang nhờ duyệt".
 */
export async function issueManagerOtp(
  input: IssueManagerOtpInput,
): Promise<IssuedOtp> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("issue_manager_otp", {
    p_action_code: input.actionCode,
    p_target_meta: input.targetMeta ?? {},
    p_branch_id: input.branchId ?? null,
    p_target_invoice_code: input.targetInvoiceCode ?? null,
    p_target_kitchen_order_number: input.targetKitchenOrderNumber ?? null,
  });

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC issue_manager_otp. Vui lòng chạy migration 00061_manager_otp_codes trước.",
      );
    }
    handleError(error, "issueManagerOtp");
  }

  if (
    !data ||
    typeof data !== "object" ||
    !("success" in data) ||
    !data.success
  ) {
    throw new Error("Server không trả OTP hợp lệ.");
  }

  const d = data as Record<string, unknown>;
  return {
    otpId: String(d.otp_id),
    code: String(d.code),
    expiresAt: String(d.expires_at),
    expiresInSeconds: Number(d.expires_in_seconds ?? 120),
    actionCode: String(d.action_code),
    issuedByName: String(d.issued_by_name ?? ""),
    targetBound: Boolean(d.target_bound),
  };
}

/**
 * Cashier (hoặc bất kỳ user nào trong tenant) nhập OTP để duyệt action.
 *
 * Atomic: row lock skip locked → 2 cashier không thể dùng cùng 1 OTP.
 * Race-safe: dù 2 manager cùng cấp OTP cho 2 cashier cùng lúc, mỗi mã chỉ
 * verify được 1 lần.
 */
export async function verifyAndUseManagerOtp(
  input: VerifyManagerOtpInput,
): Promise<VerifiedOtp> {
  const supabase = getClient();
  const code = input.code.trim();

  if (!/^[0-9]{6}$/.test(code)) {
    throw new Error("Mã OTP phải là 6 chữ số.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "verify_and_use_manager_otp",
    {
      p_code: code,
      p_action_code: input.actionCode,
      p_target_meta: input.targetMeta ?? {},
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC verify_and_use_manager_otp. Vui lòng chạy migration 00061 trước.",
      );
    }
    handleError(error, "verifyAndUseManagerOtp");
  }

  if (
    !data ||
    typeof data !== "object" ||
    !("success" in data) ||
    !data.success
  ) {
    throw new Error("Mã OTP không hợp lệ.");
  }

  const d = data as Record<string, unknown>;
  return {
    otpId: String(d.otp_id),
    actionCode: String(d.action_code),
    issuedBy: String(d.issued_by),
    issuedByName: String(d.issued_by_name ?? ""),
    issuedAt: String(d.issued_at),
    usedAt: String(d.used_at),
  };
}

/**
 * Lấy danh sách OTP gần nhất do manager đang đăng nhập cấp (history tab).
 */
export async function getRecentManagerOtps(
  limit = 10,
): Promise<RecentManagerOtp[]> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_recent_manager_otps",
    { p_limit: limit },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      // Manager page có thể tải trước khi migration apply → không throw
      // làm crash UI, chỉ trả mảng rỗng + log.
      console.warn("[getRecentManagerOtps] RPC chưa tồn tại, trả mảng rỗng.");
      return [];
    }
    handleError(error, "getRecentManagerOtps");
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const actionCode = String(row.action_code);
    return {
      id: String(row.id),
      actionCode,
      actionLabel:
        OTP_ACTION_LABELS[actionCode as OtpActionCode] ?? actionCode,
      targetMeta: (row.target_meta as Record<string, unknown>) ?? {},
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
      usedAt: row.used_at ? String(row.used_at) : null,
      usedByName: row.used_by_name ? String(row.used_by_name) : null,
      isExpired: Boolean(row.is_expired),
      isUsed: Boolean(row.is_used),
    };
  });
}
