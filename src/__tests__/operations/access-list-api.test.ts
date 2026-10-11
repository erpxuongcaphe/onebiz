import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } }) }));
import { GET as access } from "@/app/api/operations/access/route";
import { GET as list } from "@/app/api/operations/list/route";
beforeEach(() => { vi.resetAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null }); });
const request = (query: string) => new NextRequest(`http://localhost:3000/api/operations/list?${query}`);
describe("Hub entry and filtered list APIs", () => {
  it("fails closed for no session, no relation or RPC failure", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await access()).status).toBe(401);
    mocks.rpc.mockResolvedValueOnce({ data: { allowed: false }, error: null });
    expect((await access()).status).toBe(403);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "private DB details" } });
    const result = await access(); expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain("private DB");
  });
  it("uses session-bound scope without granting anything", async () => {
    mocks.rpc.mockResolvedValue({ data: { allowed: true, isCeo: false }, error: null });
    const response = await access(); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("ops_access_context");
  });
  it("rejects invalid filters without querying DB", async () => {
    expect((await list(request("kind=todo&dateField=verified"))).status).toBe(400);
    expect((await list(request("kind=todo&assignee=bad"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes combined filters to the database before paging", async () => {
    mocks.rpc.mockResolvedValue({ data: { rows: [], next: null }, error: null });
    const response = await list(request("kind=todo&category=maintenance&priority=important&state=waiting&dateField=follow_up&mine=true"));
    expect(response.status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith("ops_filtered_page", expect.objectContaining({ p_kind: "todo", p_only_mine: true, p_filters: expect.objectContaining({ category: "maintenance", priority: "important", state: "waiting", dateField: "follow_up" }) }));
  });
  it("does not retry or leak permission errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "OPS_FORBIDDEN SQL details" } });
    const response = await list(request("kind=run")); expect(response.status).toBe(403); expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await response.json())).not.toContain("SQL details");
  });
});
