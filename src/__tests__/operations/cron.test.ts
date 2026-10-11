import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    mocks.admin();
    return { rpc: mocks.rpc };
  },
}));
import { GET } from "@/app/api/cron/operations/route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe("Operations scheduler gate", () => {
  it("does not create an admin client without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(
      (await GET(new NextRequest("http://localhost:3000/api/cron/operations")))
        .status,
    ).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("rejects the wrong token", async () => {
    vi.stubEnv("CRON_SECRET", "local-secret");
    expect(
      (
        await GET(
          new NextRequest("http://localhost:3000/api/cron/operations", {
            headers: { authorization: "Bearer nope" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("calls only the Hub tick RPC once", async () => {
    vi.stubEnv("CRON_SECRET", "local-secret");
    mocks.rpc.mockResolvedValue({ data: { branches: 1 }, error: null });
    expect(
      (
        await GET(
          new NextRequest("http://localhost:3000/api/cron/operations", {
            headers: { authorization: "Bearer local-secret" },
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("ops_tick");
  });
});
