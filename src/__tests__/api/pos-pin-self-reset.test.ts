import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: { id: "self", email: "self@example.test" } as { id: string; email: string } | null,
  profile: { is_active: true, pos_pin_hash: "secret-hash", pos_pin_reset_required: false } as Record<string, unknown> | null,
  profileError: null as unknown, allowed: true, verifiedId: "self", passwordError: null as unknown, rpc: vi.fn(), verify: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: mocks.profile, error: mocks.profileError }) }) }) }) }) }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: mocks.allowed }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithPassword: mocks.verify, signOut: mocks.signOut } }) }));
import { GET, POST } from "@/app/api/auth/pos-pin/route";
const request = (body: Record<string, unknown> = {}, origin = "https://onebiz.com.vn") => new NextRequest("https://onebiz.com.vn/api/auth/pos-pin", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ password: "account-password", pin: "654321", ...body }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.user = { id: "self", email: "self@example.test" }; mocks.profile = { is_active: true, pos_pin_hash: "secret-hash", pos_pin_reset_required: false }; mocks.profileError = null; mocks.allowed = true;
  mocks.verify.mockResolvedValue({ data: { user: { id: "self" } }, error: null }); mocks.signOut.mockResolvedValue({ error: null }); mocks.rpc.mockResolvedValue({ data: { success: true }, error: null });
});
describe("own PIN status and password recovery", () => {
  it("returns boolean status without exposing the PIN hash and disables caching", async () => { const response = await GET(); expect(await response.json()).toEqual({ userId: "self", hasPin: true, resetRequired: false }); expect(response.headers.get("Cache-Control")).toBe("no-store"); });
  it("does not call a read failure 'no PIN'", async () => { mocks.profileError = { message: "offline" }; expect((await GET()).status).toBe(503); });
  it("rejects inactive accounts", async () => { mocks.profile!.is_active = false; expect((await GET()).status).toBe(403); });
  it("requires authentication for status and reset", async () => { mocks.user = null; expect((await GET()).status).toBe(401); expect((await POST(request())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("rejects cross-origin reset", async () => { expect((await POST(request({}, "https://other.test"))).status).toBe(403); expect(mocks.verify).not.toHaveBeenCalled(); });
  it("rate limits attempts by account", async () => { mocks.allowed = false; expect((await POST(request())).status).toBe(429); expect(mocks.verify).not.toHaveBeenCalled(); });
  it("validates PIN format before password verification", async () => { expect((await POST(request({ pin: "123" }))).status).toBe(400); expect(mocks.verify).not.toHaveBeenCalled(); });
  it("does not reset when password verification fails", async () => { mocks.verify.mockResolvedValue({ data: { user: null }, error: { message: "bad" } }); expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("rejects a verification response for another account", async () => { mocks.verify.mockResolvedValue({ data: { user: { id: "other" } }, error: null }); expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("binds reset to authenticated identity, never a client supplied target, and closes only temporary session", async () => { const response = await POST(request({ userId: "someone-else" })); expect(response.status).toBe(200); expect(mocks.verify).toHaveBeenCalledWith({ email: "self@example.test", password: "account-password" }); expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" }); expect(mocks.rpc).toHaveBeenCalledWith("reset_my_pos_pin_after_password_00459", { p_user_id: "self", p_new_pin: "654321" }); expect(await response.json()).toEqual({ success: true }); });
  it("does not claim success when the database reset fails", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { message: "not deployed" } }); expect((await POST(request())).status).toBe(503); });
});
