import { describe, expect, it, vi } from "vitest";
import { getPlanActivity } from "@/lib/mkt/read-models";

describe("plan activity uses the scoped audit reader", () => {
  it("requests only the chosen plan and maps the returned history", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "a", action: "update", user_id: null, new_data: { status: "ready" }, created_at: "2026-11-15" }], error: null });
    const from = vi.fn();
    const result = await getPlanActivity({ rpc, from } as never, "plan-a");
    expect(rpc).toHaveBeenCalledWith("staff_audit_entity_history", { p_entity_type: "mkt_channel_plan", p_entity_id: "plan-a", p_limit: 80 });
    expect(from).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: "a", action: "update", userName: null, createdAt: "2026-11-15", detail: { status: "ready" } }]);
  });

  it("propagates authorization failures instead of reading the raw table", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "AUDIT_ENTITY_DENIED" } });
    const from = vi.fn();
    await expect(getPlanActivity({ rpc, from } as never, "plan-b")).rejects.toThrow("AUDIT_ENTITY_DENIED");
    expect(from).not.toHaveBeenCalled();
  });
});
