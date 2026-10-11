import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
  }),
}));
import { GET as measurements } from "@/app/api/operations/measurements/route";
import {
  GET as links,
  POST as link,
} from "@/app/api/operations/mkt-links/route";
const id = "11111111-1111-4111-8111-111111111111";
const origin = "http://127.0.0.1:3044";
const get = (path: string) =>
  new NextRequest(`${origin}/api/operations/${path}`);
const post = (body: unknown = { todoId: id, taskId: id }, source = origin) =>
  new NextRequest(`${origin}/api/operations/mkt-links`, {
    method: "POST",
    headers: { origin: source, host: "127.0.0.1:3044" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  mocks.rpc.mockResolvedValue({ data: { links: [] }, error: null });
});
describe("Hub linked data boundaries", () => {
  it("requires a valid observation slot before accessing the database", async () => {
    expect(
      (
        await measurements(
          get(`measurements?runId=${id}&criterion=clean&slot=0`),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires login to read observations", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(
      (
        await measurements(
          get(`measurements?runId=${id}&criterion=clean&slot=1`),
        )
      ).status,
    ).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("delegates observation scope checking to the guarded RPC without caching", async () => {
    const result = await measurements(
      get(`measurements?runId=${id}&criterion=clean&slot=1`),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("ops_measurements_for", {
      p_run: id,
      p_criterion: "clean",
      p_slot: "1",
    });
  });
  it("does not leak SQL errors to the observation viewer", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "OPS_FORBIDDEN private SQL" },
    });
    const result = await measurements(
      get(`measurements?runId=${id}&criterion=clean&slot=1`),
    );
    expect(result.status).toBe(403);
    expect(await result.text()).not.toContain("private SQL");
  });
  it("rejects ambiguous two-sided link queries", async () => {
    expect(
      (await links(get(`mkt-links?todoId=${id}&taskId=${id}`))).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects unknown link query fields", async () => {
    expect(
      (await links(get(`mkt-links?todoId=${id}&tenantId=${id}`))).status,
    ).toBe(400);
  });
  it("bounds server search", async () => {
    expect(
      (await links(get(`mkt-links?todoId=${id}&search=${"x".repeat(201)}`)))
        .status,
    ).toBe(400);
  });
  it("requires login to create links", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await link(post())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin creation without calling the database", async () => {
    expect(
      (await link(post(undefined, "https://foreign.example"))).status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects oversized and extra payload fields", async () => {
    expect(
      (await link(post({ todoId: id, taskId: id, capability: "owner" })))
        .status,
    ).toBe(400);
    expect((await link(post({ oversized: "x".repeat(2001) }))).status).toBe(
      400,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("creates links only through the guarded RPC", async () => {
    expect((await link(post())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("ops_mkt_link", {
      p_todo: id,
      p_task: id,
    });
  });
  it("keeps the forbidden result readable and private", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "OPS_FORBIDDEN internal SQL" },
    });
    const response = await link(post());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("internal SQL");
  });
});
