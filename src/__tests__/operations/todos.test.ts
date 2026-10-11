import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
  }),
}));
import { GET } from "@/app/api/operations/todos/route";
const branch = "11111111-1111-4111-8111-111111111111";
const request = (suffix = "") =>
  new NextRequest(
    `http://localhost:3000/api/operations/todos?branch=${branch}${suffix}`,
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user" } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: { rows: [], next: null }, error: null });
});
describe("To-do pagination API", () => {
  it("rejects incomplete cursor without querying", async () => {
    expect((await GET(request("&closed=false"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid search and booleans", async () => {
    expect((await GET(request(`&search=${"x".repeat(201)}`))).status).toBe(400);
    expect((await GET(request("&mine=0"))).status).toBe(400);
  });
  it("requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves false in a complete cursor and disables caching", async () => {
    const response = await GET(
      request(
        `&closed=false&due=2026-10-01T00:00:00Z&id=${branch}&mine=true&search=test`,
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("ops_todo_page", {
      p_branch: branch,
      p_search: "test",
      p_only_mine: true,
      p_cursor_closed: false,
      p_cursor_due: "2026-10-01T00:00:00Z",
      p_cursor_id: branch,
    });
  });
  it("allows a collaborator-only scope without selecting a branch", async () => {
    expect(
      (await GET(new NextRequest("http://localhost:3000/api/operations/todos")))
        .status,
    ).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_branch).toBeNull();
  });
  it("hides backend details and does not retry", async () => {
    mocks.rpc.mockResolvedValue({
      error: { message: "OPS_FORBIDDEN private SQL" },
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("SQL");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
