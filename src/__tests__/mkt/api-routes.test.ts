import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});

// Mock Supabase server client cho toàn bộ API MKT.
const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: state.user }, error: null })),
    },
    rpc: state.rpc,
  })),
}));

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("https://mkthub.onebiz.com.vn/api/mkt/v1/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.user = { id: "user-1" };
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: { success: true }, error: null });
});

describe("MKT API routes — validate + ánh xạ RPC", () => {
  it("chặn 401 khi chưa đăng nhập", async () => {
    state.user = null;
    const { POST } = await import("@/app/api/mkt/v1/campaigns/route");
    const res = await POST(jsonRequest({ name: "Chiến dịch T07" }));
    expect(res.status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("tạo campaign thiếu tên → 400, KHÔNG gọi RPC", async () => {
    const { POST } = await import("@/app/api/mkt/v1/campaigns/route");
    const res = await POST(jsonRequest({ objective: "abc" }));
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("tạo campaign hợp lệ → gọi mkt_create_campaign đúng tham số", async () => {
    const { POST } = await import("@/app/api/mkt/v1/campaigns/route");
    const res = await POST(
      jsonRequest({ name: "Chiến dịch T07", budget: 15000000, readinessItems: [{ title: "Ops" }] }),
    );
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "mkt_create_campaign",
      expect.objectContaining({ p_name: "Chiến dịch T07", p_budget: 15000000 }),
    );
  });

  it("tạo manual task thiếu title → 400", async () => {
    const { POST } = await import("@/app/api/mkt/v1/tasks/route");
    const res = await POST(jsonRequest({ campaignId: "c1" }));
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("lỗi PL/pgSQL NOT_ASSIGNEE → HTTP 403", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "NOT_ASSIGNEE" } });
    const { POST } = await import("@/app/api/mkt/v1/campaigns/route");
    const res = await POST(jsonRequest({ name: "X" }));
    expect(res.status).toBe(403);
  });

  it("lỗi READINESS_NOT_READY → HTTP 403", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "READINESS_NOT_READY" } });
    const { POST } = await import("@/app/api/mkt/v1/campaigns/route");
    const res = await POST(jsonRequest({ name: "X" }));
    expect(res.status).toBe(403);
  });

  it("GET context → gọi mkt_get_my_context", async () => {
    state.rpc.mockResolvedValue({ data: { canView: true }, error: null });
    const { GET } = await import("@/app/api/mkt/v1/context/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("mkt_get_my_context", {});
  });

  it("waive readiness thiếu lý do → 400", async () => {
    const { POST } = await import(
      "@/app/api/mkt/v1/campaigns/[campaignId]/readiness/[itemId]/waive/route"
    );
    const res = await POST(jsonRequest({}), {
      params: Promise.resolve({ campaignId: "c1", itemId: "i1" }),
    });
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("waive readiness đủ lý do → gọi mkt_waive_readiness_item", async () => {
    const { POST } = await import(
      "@/app/api/mkt/v1/campaigns/[campaignId]/readiness/[itemId]/waive/route"
    );
    const res = await POST(jsonRequest({ reason: "Đã xác nhận miệng với Ops" }), {
      params: Promise.resolve({ campaignId: "c1", itemId: "i1" }),
    });
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "mkt_waive_readiness_item",
      expect.objectContaining({ p_campaign_id: "c1", p_item_id: "i1" }),
    );
  });
  it("review thiếu action bị chặn, không mặc định approve", async () => {
    const { POST } = await import(
      "@/app/api/mkt/v1/contents/[contentId]/review/route"
    );
    const res = await POST(jsonRequest({}), {
      params: Promise.resolve({ contentId: "content-1" }),
    });
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("review action không hợp lệ bị chặn", async () => {
    const { POST } = await import(
      "@/app/api/mkt/v1/contents/[contentId]/review/route"
    );
    const res = await POST(jsonRequest({ action: "publish" }), {
      params: Promise.resolve({ contentId: "content-1" }),
    });
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("review hợp lệ gọi RPC với action tường minh", async () => {
    const { POST } = await import(
      "@/app/api/mkt/v1/contents/[contentId]/review/route"
    );
    const res = await POST(jsonRequest({ action: "approve" }), {
      params: Promise.resolve({ contentId: "content-1" }),
    });
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "mkt_review_content",
      expect.objectContaining({ p_content_id: "content-1", p_action: "approve" }),
    );
  });
  it("team ping thiếu người nhận bị chặn", async () => {
    const { POST } = await import("@/app/api/mkt/v1/team/ping/route");
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("team ping chỉ chuyển userId vào RPC tenant-safe", async () => {
    const { POST } = await import("@/app/api/mkt/v1/team/ping/route");
    const res = await POST(jsonRequest({ userId: "member-1", message: "Cập nhật nhé" }));
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "mkt_ping_team_member",
      { p_user_id: "member-1", p_message: "Cập nhật nhé" },
    );
  });
});
