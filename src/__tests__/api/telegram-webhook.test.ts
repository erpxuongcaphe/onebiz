import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

function makeRequest(headers?: Record<string, string>) {
  return new NextRequest("https://onebiz.com.vn/api/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify({ update_id: 1 }),
  });
}

describe("Telegram webhook security", () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
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
});
