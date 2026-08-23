import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, maybeSingle } = vi.hoisted(() => ({
  from: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-1"),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));

import {
  DEFAULT_DELIVERY_PLATFORM_SETTINGS,
  getDeliveryPlatformSettings,
  getDiscountPresets,
} from "@/lib/services/supabase/fnb-platform-settings";

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReturnValue({
    select: () => ({
      eq: () => ({ maybeSingle }),
    }),
  });
});

describe("F&B platform settings - lỗi tải phải được báo rõ", () => {
  it("không biến lỗi đọc cấu hình sàn thành mức phí mặc định", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "Mất kết nối" } });

    await expect(getDeliveryPlatformSettings()).rejects.toThrow(
      "[getDeliveryPlatformSettings] Mất kết nối",
    );
  });

  it("cấu hình chưa từng lưu vẫn dùng mặc định hợp lệ", async () => {
    maybeSingle.mockResolvedValue({ data: { settings: {} }, error: null });

    await expect(getDeliveryPlatformSettings()).resolves.toEqual(
      DEFAULT_DELIVERY_PLATFORM_SETTINGS,
    );
  });

  it("không biến lỗi đọc khuyến mãi nhanh thành danh sách rỗng", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "Máy chủ bận" } });

    await expect(getDiscountPresets()).rejects.toThrow(
      "[getDiscountPresets] Máy chủ bận",
    );
  });
});
