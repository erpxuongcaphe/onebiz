/**
 * pos-pin.test.ts — Unit tests cho PIN POS service.
 *
 * Cover:
 *  - changeMyPosPin (CEO 13/05 — NV tự đặt/đổi PIN)
 *  - setUserPosPin (admin set PIN cho NV khác)
 *  - removeUserPosPin (admin gỡ PIN)
 *  - listPosPinUsers (dropdown POS)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc: mockRpc }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
}));

// rpc-utils dùng để detect RPC chưa deploy
vi.mock("@/lib/services/supabase/rpc-utils", () => ({
  isRpcUnavailable: (err: { code?: string; message?: string } | null) => {
    if (!err) return false;
    if (err.code === "PGRST202") return true;
    if (err.code === "42883") return true;
    if (err.message?.includes("function") && err.message.includes("does not exist")) return true;
    return false;
  },
}));

import {
  changeMyPosPin,
  setUserPosPin,
  removeUserPosPin,
  listPosPinUsers,
} from "@/lib/services/supabase/pos-pin";

// ============================================================
// changeMyPosPin (CEO 13/05 — Migration 00071)
// ============================================================

describe("changeMyPosPin — NV tự đặt/đổi PIN", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("set PIN lần đầu (chưa có PIN cũ) — pass oldPin=null", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, user_id: "u-1", is_first_time: true },
      error: null,
    });

    const result = await changeMyPosPin("123456", null);

    expect(mockRpc).toHaveBeenCalledWith("change_my_pos_pin", {
      p_old_pin: null,
      p_new_pin: "123456",
    });
    expect(result.isFirstTime).toBe(true);
  });

  it("đổi PIN (đã có) — pass cả oldPin + newPin", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, user_id: "u-1", is_first_time: false },
      error: null,
    });

    const result = await changeMyPosPin("234567", "123456");

    expect(mockRpc).toHaveBeenCalledWith("change_my_pos_pin", {
      p_old_pin: "123456",
      p_new_pin: "234567",
    });
    expect(result.isFirstTime).toBe(false);
  });

  it("reject PIN mới sai format (5 chữ số)", async () => {
    await expect(changeMyPosPin("12345", null)).rejects.toThrow(
      "PIN mới phải gồm đúng 6 chữ số",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reject PIN mới sai format (chữ cái)", async () => {
    await expect(changeMyPosPin("12345a", null)).rejects.toThrow(
      "PIN mới phải gồm đúng 6 chữ số",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reject PIN mới sai format (7 chữ số)", async () => {
    await expect(changeMyPosPin("1234567", null)).rejects.toThrow(
      "PIN mới phải gồm đúng 6 chữ số",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reject oldPin sai format khi pass != null", async () => {
    await expect(changeMyPosPin("123456", "abc")).rejects.toThrow(
      "PIN cũ phải gồm đúng 6 chữ số",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("propagate lỗi INVALID_OLD_PIN từ server", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "INVALID_OLD_PIN: PIN cũ không đúng", code: "P0001" },
    });

    await expect(changeMyPosPin("234567", "111111")).rejects.toThrow(
      /INVALID_OLD_PIN/,
    );
  });

  it("propagate lỗi PIN_SAME_AS_OLD từ server", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PIN_SAME_AS_OLD: PIN mới trùng PIN cũ", code: "P0001" },
    });

    await expect(changeMyPosPin("123456", "123456")).rejects.toThrow(
      /PIN_SAME_AS_OLD/,
    );
  });

  it("propagate lỗi OLD_PIN_REQUIRED khi user đã có PIN mà gọi với null", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "OLD_PIN_REQUIRED: cần nhập PIN cũ", code: "P0001" },
    });

    await expect(changeMyPosPin("234567", null)).rejects.toThrow(
      /OLD_PIN_REQUIRED/,
    );
  });

  it("báo lỗi nếu RPC chưa deploy", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "function public.change_my_pos_pin does not exist",
        code: "42883",
      },
    });

    await expect(changeMyPosPin("123456", null)).rejects.toThrow(
      "Chưa có RPC change_my_pos_pin",
    );
  });

  it("báo lỗi nếu server trả success=false", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: false },
      error: null,
    });

    await expect(changeMyPosPin("123456", null)).rejects.toThrow(
      "Server không trả kết quả đổi PIN hợp lệ",
    );
  });

  it("báo lỗi nếu server trả null data", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await expect(changeMyPosPin("123456", null)).rejects.toThrow(
      "Server không trả kết quả đổi PIN hợp lệ",
    );
  });
});

// ============================================================
// setUserPosPin (admin set PIN cho NV khác)
// ============================================================

describe("setUserPosPin — admin set PIN cho NV", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gọi RPC set_user_pos_pin với target + pin", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, user_id: "target-1", user_name: "NV A" },
      error: null,
    });

    await setUserPosPin("target-1", "654321");

    expect(mockRpc).toHaveBeenCalledWith("set_user_pos_pin", {
      p_target_user_id: "target-1",
      p_pin: "654321",
    });
  });

  it("reject PIN không phải 6 chữ số", async () => {
    await expect(setUserPosPin("target-1", "abc")).rejects.toThrow(
      "PIN phải là 6 chữ số",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("propagate lỗi PERMISSION_DENIED từ server", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PERMISSION_DENIED: cần quyền system.manage_users" },
    });

    await expect(setUserPosPin("target-1", "654321")).rejects.toThrow(
      /PERMISSION_DENIED/,
    );
  });

  it("báo lỗi nếu migration 00067 chưa chạy", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "function public.set_user_pos_pin does not exist",
        code: "42883",
      },
    });

    await expect(setUserPosPin("target-1", "654321")).rejects.toThrow(
      "Chưa có RPC set_user_pos_pin",
    );
  });
});

// ============================================================
// removeUserPosPin (admin gỡ PIN khi NV nghỉ)
// ============================================================

describe("removeUserPosPin — gỡ PIN khi NV nghỉ", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gọi RPC remove_user_pos_pin với target", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, user_id: "target-1" },
      error: null,
    });

    await removeUserPosPin("target-1");

    expect(mockRpc).toHaveBeenCalledWith("remove_user_pos_pin", {
      p_target_user_id: "target-1",
    });
  });

  it("propagate lỗi PERMISSION_DENIED", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PERMISSION_DENIED" },
    });

    await expect(removeUserPosPin("target-1")).rejects.toThrow(
      /PERMISSION_DENIED/,
    );
  });
});

// ============================================================
// listPosPinUsers (dropdown POS chọn user switch)
// ============================================================

describe("listPosPinUsers — list user có PIN tại branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("map kết quả từ RPC sang format frontend", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "u-1",
          full_name: "NV A",
          role: "cashier",
          role_name: "Thu ngân",
          has_pin: true,
          is_locked: false,
        },
        {
          id: "u-2",
          full_name: "NV B",
          role: "barista",
          role_name: "Pha chế",
          has_pin: true,
          is_locked: true,
        },
      ],
      error: null,
    });

    const users = await listPosPinUsers("branch-1");

    expect(mockRpc).toHaveBeenCalledWith("list_pos_pin_users", {
      p_branch_id: "branch-1",
    });
    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({
      id: "u-1",
      fullName: "NV A",
      role: "cashier",
      roleName: "Thu ngân",
      hasPin: true,
      isLocked: false,
    });
    expect(users[1].isLocked).toBe(true);
  });

  it("trả mảng rỗng nếu RPC chưa deploy (graceful fallback)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "function public.list_pos_pin_users does not exist",
        code: "42883",
      },
    });

    const users = await listPosPinUsers("branch-1");
    expect(users).toEqual([]);
  });

  it("xử lý role_name null", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "u-1",
          full_name: "NV A",
          role: "staff",
          role_name: null,
          has_pin: true,
          is_locked: false,
        },
      ],
      error: null,
    });

    const users = await listPosPinUsers("branch-1");
    expect(users[0].roleName).toBeNull();
  });
});
