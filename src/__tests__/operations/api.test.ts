import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
  }),
}));
import { GET, POST } from "@/app/api/operations/route";
const branchId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const command = {
  action: "generate",
  requestId,
  payload: { branchId, until: "2026-10-10" },
};
function post(body: unknown = command, origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/operations", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "test" } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: { generated: 1 }, error: null });
});
describe("Operations API", () => {
  it("requires verified authentication before reading data", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(
      (
        await GET(
          new NextRequest(
            "http://localhost:3000/api/operations?period=2026-10",
          ),
        )
      ).status,
    ).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates period before querying", async () => {
    expect(
      (
        await GET(
          new NextRequest(
            "http://localhost:3000/api/operations?period=2026-99",
          ),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses one bounded workspace RPC", async () => {
    const result = await GET(
      new NextRequest(
        `http://localhost:3000/api/operations?period=2026-10&branch=${branchId}`,
      ),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("ops_workspace", {
      p_branch: branchId,
      p_period: "2026-10",
    });
  });
  it("clearly reports an unapplied migration without retries", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Missing function" },
    });
    const response = await GET(
      new NextRequest("http://localhost:3000/api/operations?period=2026-10"),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).setupRequired).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it.each(["http://attacker.example", "null", ""])(
    "blocks cross-origin writes from %s",
    async (origin) => {
      expect((await POST(post(command, origin))).status).toBe(403);
      expect(mocks.getUser).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("rejects unknown operations", async () => {
    expect(
      (await POST(post({ ...command, action: "update_stock" }))).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires idempotency and branch UUID", async () => {
    expect((await POST(post({ ...command, requestId: "bad" }))).status).toBe(
      400,
    );
    expect((await POST(post({ ...command, payload: {} }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes session-bound writes to the atomic RPC", async () => {
    expect((await POST(post())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("ops_execute", {
      p_action: "generate",
      p_payload: command.payload,
      p_request_id: requestId,
    });
  });
  it("does not expose raw SQL errors", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "OPS_STALE: sensitive debug fields" },
    });
    const response = await POST(post());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("đã cập nhật");
  });
  it("never retries a failed mutation automatically", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "OPS_FORBIDDEN" },
    });
    expect((await POST(post())).status).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});
