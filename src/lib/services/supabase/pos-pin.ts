/**
 * POS PIN per-user service (Sprint B — CEO 12/05/2026, Approach Z).
 *
 * 3 use case:
 *   1. Owner/admin/manager đặt PIN cho cashier (setUserPosPin)
 *   2. Owner/admin gỡ PIN khi nhân viên nghỉ việc (removeUserPosPin)
 *   3. POS FnB list user có PIN tại branch (listPosPinUsers)
 *   4. POS FnB verify PIN + swap session (verifyPosPinAndSwitch)
 *      → call /api/auth/pos-pin-switch (Admin API magiclink + setSession)
 */

import { getClient, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";

// ============================================================
// Types
// ============================================================

export interface PosPinUser {
  id: string;
  fullName: string;
  role: string;
  roleName: string | null;
  hasPin: boolean;
  isLocked: boolean;
}

export interface PosPinSwitchResult {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  roleId: string | null;
}

// ============================================================
// Service functions
// ============================================================

/**
 * Owner/admin/manager đặt PIN POS cho 1 cashier.
 *
 * Server check (RPC `set_user_pos_pin`):
 *   - actor có role=owner HOẶC system.manage_users
 *   - target cùng tenant
 *   - PIN 6 chữ số
 */
export async function setUserPosPin(
  targetUserId: string,
  pin: string,
): Promise<void> {
  const supabase = getClient();

  if (!/^[0-9]{6}$/.test(pin)) {
    throw new Error("PIN phải là 6 chữ số.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("set_user_pos_pin", {
    p_target_user_id: targetUserId,
    p_pin: pin,
  });

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC set_user_pos_pin. Vui lòng chạy migration 00067 trước.",
      );
    }
    handleError(error, "setUserPosPin");
  }

  if (!data || !(data as { success?: boolean }).success) {
    throw new Error("Server không trả kết quả đặt PIN hợp lệ.");
  }
}

/**
 * Gỡ PIN khi nhân viên nghỉ việc / chuyển vai trò.
 */
export async function removeUserPosPin(targetUserId: string): Promise<void> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("remove_user_pos_pin", {
    p_target_user_id: targetUserId,
  });

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC remove_user_pos_pin. Vui lòng chạy migration 00067 trước.",
      );
    }
    handleError(error, "removeUserPosPin");
  }

  if (!data || !(data as { success?: boolean }).success) {
    throw new Error("Server không trả kết quả gỡ PIN hợp lệ.");
  }
}

/**
 * List user có PIN POS tại 1 branch — cho dropdown chọn account ở POS FnB.
 */
export async function listPosPinUsers(branchId: string): Promise<PosPinUser[]> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("list_pos_pin_users", {
    p_branch_id: branchId,
  });

  if (error) {
    if (isRpcUnavailable(error)) {
      console.warn("[listPosPinUsers] RPC chưa có, trả mảng rỗng.");
      return [];
    }
    handleError(error, "listPosPinUsers");
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    fullName: String(row.full_name),
    role: String(row.role),
    roleName: row.role_name ? String(row.role_name) : null,
    hasPin: Boolean(row.has_pin),
    isLocked: Boolean(row.is_locked),
  }));
}

/**
 * Nhân viên TỰ đổi PIN POS của chính mình (CEO 13/05).
 *
 * - Lần đầu chưa có PIN: pass oldPin = null
 * - Đã có PIN: oldPin required, server verify bằng bcrypt
 *
 * Server check (RPC `change_my_pos_pin`):
 *   - auth.uid() = user đang đăng nhập
 *   - Nếu đã có PIN cũ: bắt buộc verify oldPin (chống session-takeover)
 *   - PIN mới ≠ PIN cũ
 *   - PIN mới 6 chữ số
 */
export async function changeMyPosPin(
  newPin: string,
  oldPin: string | null,
): Promise<{ isFirstTime: boolean }> {
  const supabase = getClient();

  if (!/^[0-9]{6}$/.test(newPin)) {
    throw new Error("PIN mới phải gồm đúng 6 chữ số.");
  }
  if (oldPin !== null && !/^[0-9]{6}$/.test(oldPin)) {
    throw new Error("PIN cũ phải gồm đúng 6 chữ số.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("change_my_pos_pin", {
    p_old_pin: oldPin,
    p_new_pin: newPin,
  });

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC change_my_pos_pin. Vui lòng chạy migration 00071 trước.",
      );
    }
    handleError(error, "changeMyPosPin");
  }

  const result = data as { success?: boolean; is_first_time?: boolean } | null;
  if (!result?.success) {
    throw new Error("Server không trả kết quả đổi PIN hợp lệ.");
  }

  return { isFirstTime: Boolean(result.is_first_time) };
}

/**
 * Verify PIN + swap session sang user mới.
 *
 * Gọi API route /api/auth/pos-pin-switch:
 *   1. API verify PIN qua RPC (bcrypt compare, lock check, audit)
 *   2. API generate magiclink cho target user qua Supabase Admin API
 *   3. API return hashed_token + email
 *   4. Client (function này) gọi supabase.auth.verifyOtp() để swap session
 *   5. Sau swap, auth.uid() = target user → reload POS với user mới
 */
export async function verifyPosPinAndSwitch(
  userId: string,
  pin: string,
  branchId: string,
): Promise<PosPinSwitchResult> {
  // ─── Step 1: gọi API route verify + lấy token ───
  const res = await fetch("/api/auth/pos-pin-switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, pin, branchId }),
  });

  const body = (await res.json()) as
    | { success: true; hashed_token: string; email: string; user_id: string; full_name: string; role: string; role_id: string | null }
    | { success: false; message: string; code?: string };

  if (!body.success) {
    // Map code → message tiếng Việt rõ ràng
    const msg = body.message || "Verify PIN thất bại";
    throw new Error(msg);
  }

  // ─── Step 2: client swap session bằng verifyOtp (token_hash) ───
  // Supabase JS v2: với hashed_token từ admin.generateLink, dùng token_hash
  // (không phải token). Type 'magiclink' match với generateLink type.
  const supabase = getClient();
  const { error: otpErr } = await supabase.auth.verifyOtp({
    token_hash: body.hashed_token,
    type: "magiclink",
  });

  if (otpErr) {
    throw new Error(
      `Không swap session được: ${otpErr.message}. Vui lòng thử lại.`,
    );
  }

  return {
    userId: body.user_id,
    fullName: body.full_name,
    email: body.email,
    role: body.role,
    roleId: body.role_id,
  };
}
