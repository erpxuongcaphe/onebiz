import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  account: null as { chat_id: string } | null,
  sendImpl: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
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
    builder.lte = vi.fn(chain);
    builder.contains = vi.fn(chain);
    builder.order = vi.fn(chain);
    builder.limit = vi.fn(() => Promise.resolve({ data: state.events, error: null }));
    builder.single = vi.fn(() =>
      Promise.resolve({ data: state.account, error: null }),
    );
    builder.update = vi.fn((values: Record<string, unknown>) => {
      state.updates.push(values);
      return builder;
    });
    return { from: vi.fn(() => builder) };
  }),
}));

beforeEach(() => {
  state.events = [];
  state.account = null;
  state.updates = [];
  state.sendImpl = vi.fn().mockResolvedValue({ ok: true });
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
});

describe("processPendingOutbox", () => {
  it("bỏ qua khi chưa cấu hình bot token", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { processPendingOutbox } = await import("@/lib/mkt/outbox");
    const res = await processPendingOutbox();
    expect(res).toEqual({ checked: 0, sent: 0, failed: 0 });
    expect(state.sendImpl).not.toHaveBeenCalled();
  });

  it("gửi thành công → sent=1 + đánh dấu sent", async () => {
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
    const res = await processPendingOutbox();
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(0);
    expect(state.sendImpl).toHaveBeenCalledOnce();
    expect(state.updates.some((u) => u.status === "sent")).toBe(true);
  });

  it("người nhận chưa liên kết → failed + status failed (không retry vô hạn)", async () => {
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

  it("gửi lỗi → tăng attempts + đặt lịch retry (backoff)", async () => {
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
    expect(retryUpdate).toBeTruthy();
    expect(retryUpdate?.next_attempt_at).toBeTruthy();
    expect(retryUpdate?.last_error).toContain("Telegram 429");
  });
});
