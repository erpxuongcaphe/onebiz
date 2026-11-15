import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMktConfirmableReadinessIds } from "@/lib/mkt/read-models";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/mkt/supabase", () => ({ getMktDatabaseClient: () => ({ rpc: mocks.rpc }) }));

describe("readiness actions use server-scoped permissions", () => {
  beforeEach(() => mocks.rpc.mockReset());
  it("returns only the IDs permitted by the server for the selected campaign", async () => {
    mocks.rpc.mockResolvedValue({ data: ["allowed"], error: null });
    expect(await getMktConfirmableReadinessIds({} as never, "campaign")).toEqual(["allowed"]);
    expect(mocks.rpc).toHaveBeenCalledWith("mkt_confirmable_readiness_ids", { p_campaign_id: "campaign" });
  });
  it("fails closed when permissions cannot be loaded", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await expect(getMktConfirmableReadinessIds({} as never, "campaign")).rejects.toThrow("MKT_READ_FAILED:confirmable_readiness");
  });
});
