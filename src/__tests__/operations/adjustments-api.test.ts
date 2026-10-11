import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
  }),
}));
import { POST } from "@/app/api/operations/adjustments/route";
const id = "11111111-1111-4111-8111-111111111111";
const body = {
  action: "propose",
  periodId: id,
  baseRevision: 0,
  revenueCents: 500000,
  targetCents: 1000000,
  reason: "Đối chiếu số liệu",
  evidence: "Báo cáo ký xác nhận",
  requestId: id,
};
const request = (value: unknown = body) =>
  new NextRequest("http://localhost:3000/api/operations/adjustments", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  mocks.rpc.mockResolvedValue({ data: { id }, error: null });
});
describe("Closed period adjustment API", () => {
  it("routes result corrections through the versioned proposal, never updates original runs", async () => {
    const proposal = {
      action: body.action,
      periodId: body.periodId,
      baseRevision: body.baseRevision,
      reason: body.reason,
      evidence: body.evidence,
      requestId: body.requestId,
    };
    expect(
      (
        await POST(
          request({
            ...proposal,
            action: "propose_result",
            changes: [
              {
                runId: id,
                observations: [{ criterionId: "clean", slot: "1", value: 1 }],
              },
            ],
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rpc.mock.calls[0][0]).toBe("ops_propose_result_adjustment");
    expect(mocks.rpc.mock.calls[0][1].p_base).toBe(0);
  });
  it("rejects a result correction without an affected run", async () => {
    const proposal = {
      action: body.action,
      periodId: body.periodId,
      baseRevision: body.baseRevision,
      reason: body.reason,
      evidence: body.evidence,
      requestId: body.requestId,
    };
    expect(
      (
        await POST(
          request({ ...proposal, action: "propose_result", changes: [] }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects fractional cents", async () => {
    expect((await POST(request({ ...body, revenueCents: 1.5 }))).status).toBe(
      400,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects zero targets", async () => {
    expect((await POST(request({ ...body, targetCents: 0 }))).status).toBe(400);
  });
  it("requires verified login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("submits a proposal without changing existing invoices", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][0]).toBe("ops_propose_adjustment");
  });
  it("returns a readable conflict without leaking SQL", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "OPS_STALE secret SQL" },
    });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("SQL");
  });
});
