import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  rpc: vi.fn(),
  context: { canView: true, canManageAssets: false },
  signedUpload: vi.fn(),
}));

const profileQuery = {
  select: vi.fn(() => profileQuery),
  eq: vi.fn(() => profileQuery),
  maybeSingle: vi.fn(async () => ({
    data: { tenant_id: "tenant-1" },
    error: null,
  })),
};

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: state.user }, error: null })),
    },
    rpc: state.rpc,
    from: vi.fn(() => profileQuery),
  })),
}));

vi.mock("@/lib/mkt/read-models", () => ({
  getMktContext: vi.fn(async () => state.context),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        createSignedUploadUrl: state.signedUpload,
      })),
    },
  })),
}));

function request(body: unknown): NextRequest {
  return new NextRequest("https://mkthub.onebiz.com.vn/api/mkt/v1/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.user = { id: "user-1" };
  state.context = { canView: true, canManageAssets: false };
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: { success: true }, error: null });
  state.signedUpload.mockReset();
  state.signedUpload.mockResolvedValue({
    data: { path: "tenant-1/media.png", token: "token" },
    error: null,
  });
});

describe("MKT hardening API routes", () => {
  it("requires a pillar when creating content", async () => {
    const { POST } = await import("@/app/api/mkt/v1/contents/route");
    const response = await POST(request({ campaignId: "campaign-1", title: "Post" }));
    expect(response.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("passes a required pillar to the content RPC", async () => {
    const { POST } = await import("@/app/api/mkt/v1/contents/route");
    const response = await POST(
      request({ campaignId: "campaign-1", title: "Post", pillarId: "pillar-1" }),
    );
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "mkt_create_content_item",
      expect.objectContaining({ p_pillar_id: "pillar-1" }),
    );
  });

  it("rejects an unknown readiness responsibility", async () => {
    const { POST } = await import("@/app/api/mkt/v1/campaigns/[campaignId]/readiness/route");
    const response = await POST(
      request({ title: "Ready", requiredRole: "random-title" }),
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );
    expect(response.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("accepts a legacy responsibility alias without using it as a job title", async () => {
    const { POST } = await import("@/app/api/mkt/v1/campaigns/[campaignId]/readiness/route");
    const response = await POST(
      request({ title: "CEO approval", requiredRole: "owner" }),
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "mkt_add_readiness_item",
      expect.objectContaining({ p_required_role: "owner" }),
    );
  });

  it("requires a reason when reconciling a running plan task", async () => {
    const { POST } = await import("@/app/api/mkt/v1/plans/[planId]/reconcile-task/route");
    const response = await POST(
      request({ taskId: "task-1", decision: "cancel" }),
      { params: Promise.resolve({ planId: "plan-1" }) },
    );
    expect(response.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("binds reconcile to plan id and forwards the reason", async () => {
    const { POST } = await import("@/app/api/mkt/v1/plans/[planId]/reconcile-task/route");
    const response = await POST(
      request({ taskId: "task-1", decision: "cancel", reason: "Scope changed" }),
      { params: Promise.resolve({ planId: "plan-1" }) },
    );
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "mkt_reconcile_plan_task",
      expect.objectContaining({
        p_plan_id: "plan-1",
        p_task_id: "task-1",
        p_reason: "Scope changed",
      }),
    );
  });

  it("denies signed upload URLs without asset-management permission", async () => {
    const { POST } = await import("@/app/api/mkt/v1/media/upload-url/route");
    const response = await POST(
      request({ fileName: "media.png", mimeType: "image/png", sizeBytes: 1024 }),
    );
    expect(response.status).toBe(403);
    expect(state.signedUpload).not.toHaveBeenCalled();
  });

  it("rejects oversized media before requesting a signed URL", async () => {
    state.context = { canView: true, canManageAssets: true };
    const { POST } = await import("@/app/api/mkt/v1/media/upload-url/route");
    const response = await POST(
      request({
        fileName: "large.mp4",
        mimeType: "video/mp4",
        sizeBytes: 25 * 1024 * 1024 + 1,
      }),
    );
    expect(response.status).toBe(400);
    expect(state.signedUpload).not.toHaveBeenCalled();
  });
});
