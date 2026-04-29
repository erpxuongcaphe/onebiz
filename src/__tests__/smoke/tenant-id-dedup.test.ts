/**
 * Smoke test: getCurrentTenantId() in-flight promise dedup.
 *
 * Bug history: 9 services cùng gọi getCurrentTenantId() song song khi page
 * mount → mỗi cái call supabase.auth.getUser() riêng → lock contention.
 * Fix: in-flight promise — N caller share 1 promise duy nhất.
 *
 * Test này verify pattern dedup hoạt động: khi 50 concurrent calls,
 * underlying auth.getUser() chỉ được gọi 1 lần (sau cache populated, 0 lần).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase client — track số lần auth.getUser() được gọi
const getUserMock = vi.fn();
const profilesSingleMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: profilesSingleMock,
          limit: vi.fn(() => ({
            single: profilesSingleMock,
          })),
        })),
        limit: vi.fn(() => ({
          single: profilesSingleMock,
        })),
      })),
    })),
  })),
}));

describe("getCurrentTenantId in-flight dedup", () => {
  beforeEach(() => {
    vi.resetModules();
    getUserMock.mockReset();
    profilesSingleMock.mockReset();

    // Default mock: user authenticated với tenant
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });
    profilesSingleMock.mockResolvedValue({
      data: { tenant_id: "tenant-1" },
      error: null,
    });
  });

  it("50 concurrent calls → auth.getUser() chỉ gọi 1 lần", async () => {
    const { getCurrentTenantId } = await import("@/lib/services/supabase/base");

    // Fire 50 concurrent calls trước khi cache populated
    const results = await Promise.all(
      Array.from({ length: 50 }, () => getCurrentTenantId()),
    );

    // Tất cả phải trả cùng tenant_id
    expect(results.every((r) => r === "tenant-1")).toBe(true);

    // CRITICAL: getUser chỉ được gọi 1 lần thay vì 50 lần
    expect(getUserMock).toHaveBeenCalledTimes(1);
  });

  it("call sau khi cache populated → 0 lần getUser()", async () => {
    const { getCurrentTenantId } = await import("@/lib/services/supabase/base");

    // Lần đầu: populate cache
    await getCurrentTenantId();
    expect(getUserMock).toHaveBeenCalledTimes(1);

    // 100 lần tiếp theo: dùng cache
    getUserMock.mockClear();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => getCurrentTenantId()),
    );

    expect(results.every((r) => r === "tenant-1")).toBe(true);
    expect(getUserMock).toHaveBeenCalledTimes(0);
  });
});
