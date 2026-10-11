import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
  }),
}));
import { GET } from "@/app/api/operations/history/route";
const branch = "11111111-1111-4111-8111-111111111111";
const request = (suffix = "") =>
  new NextRequest(
    `http://localhost:3000/api/operations/history?branch=${branch}&period=2026-10${suffix}`,
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user" } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: { rows: [], next: null }, error: null });
});
describe("History API", () => {
  it("rejects a half cursor before querying", async () => {
    expect((await GET(request("&cursorAt=2026-10-01T00:00:00Z"))).status).toBe(
      400,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses a single noncached scoped read", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("ops_history", {
      p_branch: branch,
      p_period: "2026-10",
      p_kind: "audit",
      p_cursor_at: null,
      p_cursor_id: null,
    });
  });
  it("does not leak SQL when permission is denied", async () => {
    mocks.rpc.mockResolvedValue({
      error: { message: "OPS_FORBIDDEN private SQL text" },
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("SQL");
  });
});
