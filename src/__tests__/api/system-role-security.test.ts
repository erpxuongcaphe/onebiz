import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { systemRoleError, systemRoleRequest } from "@/lib/admin/system-role";

const state = vi.hoisted(() => ({ authenticated: true, role: "owner", active: true, rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn(async () => ({
  auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: "actor" } : null }, error: null }) },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: state.role, is_active: state.active } }) }) }) }),
  rpc: state.rpc,
})) }));
const body = { userId: "927959eb-45fe-48fb-bace-fcf19d6f5b2e", expectedRole: "staff", makeOwner: true,
  reason: "Bổ nhiệm CEO", confirmation: "ceo@example.test", requestId: "ac764e39-8a4b-45de-b0e5-004106983764" };
const request = (payload: unknown = body) => new NextRequest("http://localhost/api/admin/system-role", { method: "POST", body: JSON.stringify(payload) });
beforeEach(() => { vi.clearAllMocks(); state.authenticated = true; state.role = "owner"; state.active = true; state.rpc.mockResolvedValue({ error: null }); });

describe("system role API security", () => {
  it("rejects unauthenticated callers without invoking RPC", async () => {
    state.authenticated = false;
    const { POST } = await import("@/app/api/admin/system-role/route");
    expect((await POST(request())).status).toBe(401); expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(["admin", "staff", "manager"])("rejects %s even with a management job title", async role => {
    state.role = role;
    const { POST } = await import("@/app/api/admin/system-role/route");
    expect((await POST(request())).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects inactive owner", async () => {
    state.active = false;
    const { POST } = await import("@/app/api/admin/system-role/route");
    expect((await POST(request())).status).toBe(403);
  });
  it("rejects invalid or injected payload", async () => {
    const { POST } = await import("@/app/api/admin/system-role/route");
    for (const invalid of [{ ...body, reason: "" }, { ...body, makeOwner: "true" }, { ...body, tenantId: "other" }, { ...body, userId: "invalid" }]) {
      expect((await POST(request(invalid))).status).toBe(400);
    }
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("uses authenticated atomic RPC, never a service-role update", async () => {
    const { POST } = await import("@/app/api/admin/system-role/route");
    expect((await POST(request())).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("set_user_system_role_atomic", {
      p_target: body.userId, p_expected_role: "staff", p_make_owner: true, p_reason: body.reason,
      p_confirmation: body.confirmation, p_request: body.requestId,
    });
  });
  it.each(["ROLE_STALE", "ROLE_LAST_OWNER", "ROLE_REQUEST_CONFLICT"])("returns a truthful conflict for %s", async code => {
    state.rpc.mockResolvedValue({ error: { message: code } });
    const { POST } = await import("@/app/api/admin/system-role/route");
    expect((await POST(request())).status).toBe(409);
  });
  it("hides unknown database details", () => {
    expect(systemRoleError("database password secret").message).not.toContain("secret");
  });
  it("allows legacy role values only as a stale-check value", () => {
    expect(systemRoleRequest.safeParse({ ...body, expectedRole: "warehouse" }).success).toBe(true);
  });
});
