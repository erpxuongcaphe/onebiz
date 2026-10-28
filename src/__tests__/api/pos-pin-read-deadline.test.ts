import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), profile: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
import { GET } from "@/app/api/auth/pos-pin/route";
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "self" } }, error: null });
  mocks.profile.mockResolvedValue({ data: { is_active: true, pos_pin_hash: "private", pos_pin_reset_required: false }, error: null });
  mocks.create.mockResolvedValue({ auth: { getUser: mocks.getUser }, from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("PIN read outage handling without granting access", () => {
  it.each([0, 429, 500, 503, 504])("returns retryable unavailable for Auth status %s without reading the profile", async status => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError", status } });
    const response = await GET(new NextRequest("https://onebiz.com.vn/api/auth/pos-pin")); expect(response.status).toBe(503); expect(response.headers.get("Retry-After")).toBe("5"); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).not.toHaveProperty("hasPin"); expect(mocks.profile).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403])("keeps invalid Auth status %s locked without automatic permission fallback", async status => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthApiError", status } });
    expect((await GET(new NextRequest("https://onebiz.com.vn/api/auth/pos-pin"))).status).toBe(401); expect(mocks.profile).not.toHaveBeenCalled();
  });
  it("blocks missing sessions and inactive accounts", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    expect((await GET(new NextRequest("https://onebiz.com.vn/api/auth/pos-pin"))).status).toBe(401);
    mocks.profile.mockResolvedValue({ data: { is_active: false, pos_pin_hash: "private" }, error: null });
    expect((await GET(new NextRequest("https://onebiz.com.vn/api/auth/pos-pin"))).status).toBe(403);
  });
  it("responds at eight seconds even when the Auth SDK operation does not settle, aborting its transport", async () => {
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}); }));
    mocks.create.mockImplementation(async ({ fetch: transport }) => ({ auth: { getUser: () => transport("https://example.test/auth/v1/user") } }));
    const promise = GET(new NextRequest("https://onebiz.com.vn/api/auth/pos-pin")); await vi.advanceTimersByTimeAsync(8000);
    expect((await promise).status).toBe(503); expect(signal.aborted).toBe(true); expect(mocks.profile).not.toHaveBeenCalled();
  });
  it("shares one deadline between Auth and profile reads", async () => {
    mocks.getUser.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: { user: { id: "self" } }, error: null }), 6000)));
    mocks.profile.mockReturnValue(new Promise(() => {}));
    const promise = GET(new NextRequest("https://onebiz.com.vn/api/auth/pos-pin")); await vi.advanceTimersByTimeAsync(8000);
    expect((await promise).status).toBe(503); expect(mocks.profile).toHaveBeenCalledTimes(1);
  });
  it("cancels on caller disconnect and exposes no PIN hash on success", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await GET(new NextRequest("https://example.test/api/auth/pos-pin", { signal: controller.signal }))).status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
    const response = await GET(new NextRequest("https://onebiz.com.vn/api/auth/pos-pin")); expect(await response.json()).toEqual({ userId: "self", hasPin: true, resetRequired: false });
  });
  it("treats unexpected transport exceptions as unavailable, never as no PIN", async () => {
    mocks.getUser.mockRejectedValue(new TypeError("network"));
    const response = await GET(new NextRequest("https://onebiz.com.vn/api/auth/pos-pin")); expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty("hasPin");
  });
});
