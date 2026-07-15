import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpcResult: { success: true, linked: false } as Record<string, unknown>,
  rpc: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(() => ({ rpc: state.rpc })),
}));

vi.mock("@/lib/mkt/telegram", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/mkt/telegram")>();
  return { ...original, sendTelegramMessage: state.send };
});

function makeRequest(
  headers?: Record<string, string>,
  body: Record<string, unknown> = { update_id: 1 },
) {
  return new NextRequest("https://onebiz.com.vn/api/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

const validHeaders = {
  "x-telegram-bot-api-secret-token": "test-secret",
};

const linkUpdate = {
  update_id: 1001,
  message: {
    text: "/start link_raw-token",
    chat: { id: 123, type: "private" },
    from: { id: 123, username: "tester" },
  },
};

describe("Telegram webhook security and idempotency", () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    state.rpcResult = { success: true, linked: false };
    state.rpc = vi.fn().mockImplementation(() =>
      Promise.resolve({ data: state.rpcResult, error: null }),
    );
    state.send.mockReset();
    state.send.mockResolvedValue({ ok: true });
  });

  it("rejects requests without the Telegram secret header", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
  });

  it("rejects requests with a wrong Telegram secret header", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const response = await POST(
      makeRequest({ "x-telegram-bot-api-secret-token": "wrong" }),
    );
    expect(response.status).toBe(401);
  });

  it("ignores link commands from group chats", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const response = await POST(
      makeRequest(validHeaders, {
        update_id: 1002,
        message: {
          text: "/start link_raw-token",
          chat: { id: -100123, type: "supergroup" },
          from: { id: 123, username: "tester" },
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("ignores duplicate update without sending another message", async () => {
    state.rpcResult = { success: true, duplicate: true, linked: false };
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const response = await POST(makeRequest(validHeaders, linkUpdate));
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "mkt_consume_telegram_link_token",
      expect.objectContaining({ p_update_id: 1001 }),
    );
    expect(state.send).not.toHaveBeenCalled();
  });

  it("sends one confirmation after an atomic successful link", async () => {
    state.rpcResult = { success: true, linked: true };
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const response = await POST(makeRequest(validHeaders, linkUpdate));
    expect(response.status).toBe(200);
    expect(state.send).toHaveBeenCalledOnce();
    expect(state.send).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "123", deepLinkPath: "/" }),
    );
  });
});
