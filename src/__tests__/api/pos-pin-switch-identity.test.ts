import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const target = "11111111-1111-4111-8111-111111111111";
const branch = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), lookup: vi.fn(), generate: vi.fn(), admin: vi.fn(),
  caller: { id: "caller" } as { id: string } | null, allowed: true }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.caller }, error: null }) }, rpc: mocks.rpc,
}) }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => { mocks.admin(); return { auth: { admin: { getUserById: mocks.lookup, generateLink: mocks.generate } } }; } }));
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", checkRateLimit: () => ({ allowed: mocks.allowed, resetAt: Date.now() + 60000 }) }));
import { POST } from "@/app/api/auth/pos-pin-switch/route";
const request = () => new NextRequest("https://fnb.onebiz.com.vn/api/auth/pos-pin-switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: target, pin: "123456", branchId: branch }) });
const verified = (extra = {}) => ({ success: true, user_id: target, full_name: "Employee", email: null, tenant_id: "tenant", role: "cashier", role_id: null, ...extra });
beforeEach(() => {
  vi.clearAllMocks(); mocks.caller = { id: "caller" }; mocks.allowed = true;
  mocks.rpc.mockResolvedValue({ data: verified(), error: null });
  mocks.lookup.mockResolvedValue({ data: { user: { id: target, email: "phone-account@example.invalid" } }, error: null });
  mocks.generate.mockResolvedValue({ data: { user: { id: target }, properties: { hashed_token: "mock-hash" } }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe("POS PIN handover binds session to verified Auth identity", () => {
  it("supports staff with no contact email using their existing Auth account", async () => {
    const r = await POST(request()); expect(r.status).toBe(200); expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("verify_pos_pin", { p_user_id: target, p_pin: "123456", p_branch_id: branch });
    expect(mocks.lookup).toHaveBeenCalledWith(target);
    expect(mocks.generate).toHaveBeenCalledWith({ type: "magiclink", email: "phone-account@example.invalid" });
    expect(await r.json()).toMatchObject({ success: true, hashed_token: "mock-hash", user_id: target });
  });
  it("does not use a stale contact email to create a session for another identity", async () => {
    mocks.rpc.mockResolvedValue({ data: verified({ email: "another-contact@example.invalid" }), error: null });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.generate).toHaveBeenCalledWith({ type: "magiclink", email: "phone-account@example.invalid" });
  });
  it("requires a logged-in caller before any privileged Auth call", async () => {
    mocks.caller = null; expect((await POST(request())).status).toBe(401); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("preserves PIN rate limiting", async () => {
    mocks.allowed = false; expect((await POST(request())).status).toBe(429); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("does not create a session when the PIN is wrong", async () => {
    mocks.rpc.mockResolvedValue({ data: { success: false, code: "INVALID_PIN", attempts_remaining: 3 }, error: null });
    expect((await POST(request())).status).toBe(401); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("does not bypass branch, tenant or FnB permissions", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "PIN_HANDOVER_BRANCH_DENIED" } });
    expect((await POST(request())).status).toBe(403); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("rejects an unexpected verified target before privileged Auth access", async () => {
    mocks.rpc.mockResolvedValue({ data: verified({ user_id: other }), error: null });
    expect((await POST(request())).status).toBe(503); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("does not generate a link if the Auth lookup fails", async () => {
    mocks.lookup.mockResolvedValue({ data: { user: null }, error: { code: "user_not_found", status: 404 } });
    expect((await POST(request())).status).toBe(503); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("rejects an Auth lookup for a different user", async () => {
    mocks.lookup.mockResolvedValue({ data: { user: { id: other, email: "other@example.invalid" } }, error: null });
    expect((await POST(request())).status).toBe(503); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("does not fall back to contact email when the Auth account has no email", async () => {
    mocks.rpc.mockResolvedValue({ data: verified({ email: "contact@example.invalid" }), error: null });
    mocks.lookup.mockResolvedValue({ data: { user: { id: target, email: " " } }, error: null });
    expect((await POST(request())).status).toBe(503); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("keeps session creation errors retryable without returning a token", async () => {
    mocks.generate.mockResolvedValue({ data: null, error: { code: "validation_failed", status: 400 } });
    const r = await POST(request()); expect(r.status).toBe(503); expect(await r.json()).toMatchObject({ success: false, code: "SESSION_CREATION_FAILED" });
  });
  it("rejects a generated link belonging to another account", async () => {
    mocks.generate.mockResolvedValue({ data: { user: { id: other }, properties: { hashed_token: "other-hash" } }, error: null });
    const r = await POST(request()); expect(r.status).toBe(503); expect(JSON.stringify(await r.json())).not.toContain("other-hash");
  });
  it("does not leak OTP/link secrets to logs when the token response is incomplete", async () => {
    mocks.generate.mockResolvedValue({ data: { user: { id: target }, properties: { email_otp: "secret-otp", action_link: "https://example.invalid/secret-link" } }, error: null });
    const r = await POST(request()); expect(r.status).toBe(503);
    const output = JSON.stringify([await r.json(), vi.mocked(console.error).mock.calls]); expect(output).not.toContain("secret-otp"); expect(output).not.toContain("secret-link");
  });
});
