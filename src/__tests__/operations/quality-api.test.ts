import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
  }),
}));
import { GET, POST } from "@/app/api/operations/quality/route";
const branch = "11111111-1111-4111-8111-111111111111";
const command = {
  action: "check",
  requestId: branch,
  payload: { branchId: branch, id: branch, version: 1, observations: [] },
};
const post = (body: unknown = command, origin = "http://localhost:3000") =>
  new NextRequest("http://localhost:3000/api/operations/quality", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: branch } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: { rows: [] }, error: null });
});
describe("QC API preserves authenticated session and atomic server authorization", () => {
  it("GET is read-only and private", async () => {
    const r = await GET(
      new NextRequest(
        `http://localhost:3000/api/operations/quality?branch=${branch}&period=2026-10`,
      ),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "ops_quality_read",
      expect.objectContaining({ p_branch: branch, p_period: "2026-10" }),
    );
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("rejects invalid month before querying", async () => {
    expect(
      (
        await GET(
          new NextRequest(
            `http://localhost:3000/api/operations/quality?branch=${branch}&period=2026-13`,
          ),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires verified session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(post())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["", "null", "https://other.invalid"])(
    "rejects write origin %s",
    async (origin) => {
      expect((await POST(post(command, origin))).status).toBe(403);
      expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );
  it("passes request key without administrative client", async () => {
    expect((await POST(post())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("ops_quality_execute", {
      p_action: "check",
      p_payload: command.payload,
      p_request_id: branch,
    });
  });
  it("rejects arbitrary or stock command", async () => {
    expect(
      (await POST(post({ ...command, action: "update_stock" }))).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reports missing migration without retries", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "missing" },
    });
    const r = await POST(post());
    expect(r.status).toBe(503);
    expect((await r.json()).setupRequired).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("returns safe Vietnamese errors, no raw SQL", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "OPS_STALE internal SQL detail" },
    });
    const r = await POST(post());
    expect(r.status).toBe(409);
    expect((await r.json()).error).not.toContain("SQL");
  });
  it("rejects oversized streamed body", async () => {
    const r = await POST(post({ ...command, extra: "x".repeat(200001) }));
    expect(r.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
