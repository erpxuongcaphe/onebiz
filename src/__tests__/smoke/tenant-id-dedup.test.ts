/**
 * Smoke test: getCurrentTenantId() + getCurrentContext() share profile cache.
 *
 * Bug history:
 * - V1: 9 services cùng gọi getCurrentTenantId() song song khi page mount →
 *   mỗi cái call supabase.auth.getUser() riêng → lock contention.
 *   Fix: in-flight promise — N caller share 1 promise duy nhất.
 * - V2 (PERF F8 + F2): getUser() → getSession() (instant cookie read);
 *   getCurrentTenantId() và getCurrentContext() share `cachedProfile` thay vì
 *   mỗi function tự cache riêng → 3 profile fetch → 1 fetch.
 *
 * Test verify: 50 concurrent calls → auth.getSession() chỉ gọi 1 lần.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase client — track số lần auth.getSession() được gọi
const getSessionMock = vi.fn();
const profilesSingleMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: { getSession: getSessionMock },
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
    getSessionMock.mockReset();
    profilesSingleMock.mockReset();

    // Default mock: user authenticated với tenant (qua session cookie)
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
    profilesSingleMock.mockResolvedValue({
      data: { tenant_id: "tenant-1", branch_id: null },
      error: null,
    });
  });

  it("50 concurrent calls → auth.getSession() chỉ gọi 1 lần", async () => {
    const { getCurrentTenantId } = await import("@/lib/services/supabase/base");

    // Fire 50 concurrent calls trước khi cache populated
    const results = await Promise.all(
      Array.from({ length: 50 }, () => getCurrentTenantId()),
    );

    // Tất cả phải trả cùng tenant_id
    expect(results.every((r) => r === "tenant-1")).toBe(true);

    // CRITICAL: getSession chỉ được gọi 1 lần thay vì 50 lần
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });

  it("call sau khi cache populated → 0 lần getSession()", async () => {
    const { getCurrentTenantId } = await import("@/lib/services/supabase/base");

    // Lần đầu: populate cache
    await getCurrentTenantId();
    expect(getSessionMock).toHaveBeenCalledTimes(1);

    // 100 lần tiếp theo: dùng cache
    getSessionMock.mockClear();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => getCurrentTenantId()),
    );

    expect(results.every((r) => r === "tenant-1")).toBe(true);
    expect(getSessionMock).toHaveBeenCalledTimes(0);
  });
});
