import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  account: null as { chat_id: string } | null,
  sendImpl: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
  claims: [] as Array<Record<string, unknown>>,
  claimError: null as { message: string } | null,
}));

vi.mock("@/lib/mkt/telegram", () => ({
  sendTelegramMessage: (...args: unknown[]) => state.sendImpl(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(() => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = vi.fn(chain);
    builder.eq = vi.fn(chain);
    builder.single = vi.fn(() =>
      Promise.resolve({ data: state.account, error: null }),
    );
    builder.update = vi.fn((values: Record<string, unknown>) => {
      state.updates.push(values);
      return builder;
    });
    return {
      rpc: vi.fn((_name: string, args: Record<string, unknown>) => {
        state.claims.push(args);
        return Promise.resolve({ data: state.events, error: state.claimError });
      }),
      from: vi.fn(() => builder),
    };
  }),
}));

beforeEach(() => {
  state.events = [];
  state.account = null;
  state.updates = [];
  state.claims = [];
  state.claimError = null;
  state.sendImpl = vi.fn().mockResolvedValue({ ok: true });
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
});

describe("processPendingOutbox", () => {
  it("surfaces outbox claim failures", async () => {
    state.claimError = { message: "RPC missing" };
    const { processPendingOutbox } = await import("@/lib/mkt/outbox");

    await expect(processPendingOutbox()).rejects.toThrow(
      "MKT_OUTBOX_CLAIM_FAILED: RPC missing",
    );
    expect(state.sendImpl).not.toHaveBeenCalled();
  });

  it("bỏ qua khi chưa cấu hình bot token", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { processPendingOutbox } = await import("@/lib/mkt/outbox");
    const res = await processPendingOutbox();
    expect(res).toEqual({ checked: 0, sent: 0, failed: 0 });
    expect(state.sendImpl).not.toHaveBeenCalled();
  });

  it("claim nguyên tử trước khi gửi và đánh dấu sent", async () => {
    state.events = [
      {
        id: "e1",
        tenant_id: "t1",
        recipient_user_id: "u1",
        title: "Task MKT mới",
        message: "Quay TikTok",
        deep_link_path: "/mkt/tasks?task=x",
        attempts: 0,
      },
    ];
    state.account = { chat_id: "123" };
    const { processPendingOutbox } = await import("@/lib/mkt/outbox");
    const res = await processPendingOutbox(7);
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(0);
    expect(state.claims).toHaveLength(1);
    expect(state.claims[0]).toEqual(
      expect.objectContaining({ p_limit: 7, p_worker_id: expect.any(String) }),
    );
    expect(state.sendImpl).toHaveBeenCalledOnce();
    expect(state.updates.some((u) => u.status === "sent")).toBe(true);
  });

  it("người nhận chưa liên kết thì kết thúc failed", async () => {
    state.events = [
      {
        id: "e2",
        tenant_id: "t1",
        recipient_user_id: "u2",
        title: "X",
        message: null,
        deep_link_path: null,
        attempts: 0,
      },
    ];
    state.account = null;
    const { processPendingOutbox } = await import("@/lib/mkt/outbox");
    const res = await processPendingOutbox();
    expect(res.failed).toBe(1);
    expect(state.sendImpl).not.toHaveBeenCalled();
    expect(state.updates.some((u) => u.status === "failed")).toBe(true);
  });

  it("gửi lỗi trả event về pending để retry có giới hạn", async () => {
    state.events = [
      {
        id: "e3",
        tenant_id: "t1",
        recipient_user_id: "u3",
        title: "X",
        message: null,
        deep_link_path: null,
        attempts: 1,
      },
    ];
    state.account = { chat_id: "999" };
    state.sendImpl = vi.fn().mockRejectedValue(new Error("Telegram 429"));
    const { processPendingOutbox } = await import("@/lib/mkt/outbox");
    const res = await processPendingOutbox();
    expect(res.failed).toBe(1);
    const retryUpdate = state.updates.find((u) => u.attempts === 2);
    expect(retryUpdate).toEqual(
      expect.objectContaining({
        status: "pending",
        next_attempt_at: expect.any(String),
        last_error: expect.stringContaining("Telegram 429"),
      }),
    );
  });

  it("dừng retry sau MAX_ATTEMPTS", async () => {
    state.events = [
      {
        id: "e4",
        tenant_id: "t1",
        recipient_user_id: "u4",
        title: "X",
        message: null,
        deep_link_path: null,
        attempts: 4,
      },
    ];
    state.account = { chat_id: "999" };
    state.sendImpl = vi.fn().mockRejectedValue(new Error("Telegram 500"));
    const { processPendingOutbox } = await import("@/lib/mkt/outbox");
    await processPendingOutbox();
    expect(state.updates).toContainEqual(
      expect.objectContaining({ status: "failed", attempts: 5 }),
    );
  });
});
