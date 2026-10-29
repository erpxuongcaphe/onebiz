import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
  abortSignal: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(() => ({ from: state.from })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  state.from.mockReturnValue({ select: state.select });
  state.select.mockReturnValue({ limit: state.limit });
  state.limit.mockReturnValue({ abortSignal: state.abortSignal });
  state.abortSignal.mockResolvedValue({ error: null });
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
    state.abortSignal.mockResolvedValue({ error: { message: "private database detail" } });
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      db: "error",
      error: "DATABASE_UNAVAILABLE",
    });
  });

  it("coalesces concurrent probes and briefly reuses a healthy result without counting tenants", async () => {
    let complete!: (value: { error: null }) => void;
    state.abortSignal.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const { GET } = await import("@/app/api/health/route");
    const first = GET();
    const second = GET();
    complete({ error: null });
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await GET()).status).toBe(200);
    expect(state.from).toHaveBeenCalledTimes(1);
    expect(state.select).toHaveBeenCalledWith("id", { head: true });
  });

  it("returns 503 within the deadline even when the upstream never settles", async () => {
    vi.useFakeTimers();
    try {
      state.abortSignal.mockReturnValue(new Promise(() => {}));
      const { GET } = await import("@/app/api/health/route");
      const pending = GET();
      await vi.advanceTimersByTimeAsync(5000);
      expect((await pending).status).toBe(503);
      expect(state.abortSignal.mock.calls[0][0].aborted).toBe(true);
      state.abortSignal.mockResolvedValue({ error: null });
      await vi.advanceTimersByTimeAsync(2001);
      expect((await GET()).status).toBe(200);
    } finally { vi.useRealTimers(); }
  });
});
