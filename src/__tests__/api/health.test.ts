import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(() => ({ from: state.from })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.from.mockReturnValue({ select: state.select });
  state.select.mockReturnValue({ limit: state.limit });
  state.limit.mockResolvedValue({ error: null });
});

describe("GET /api/health", () => {
  it("checks database connectivity with the server-only admin client", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(state.from).toHaveBeenCalledWith("tenants");
    expect(await response.json()).toMatchObject({ status: "ok", db: "connected" });
  });

  it("returns degraded when the database check fails", async () => {
    state.limit.mockResolvedValue({ error: { message: "connection failed" } });
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      db: "error",
      error: "connection failed",
    });
  });
});
