import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseState = vi.hoisted(() => ({
  user: null as unknown,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: supabaseState.user } })),
    },
  })),
}));

function makeRequest(url: string): NextRequest {
  return new NextRequest(url, {
    headers: { host: new URL(url).host },
  });
}

describe("FnB subdomain routing", () => {
  beforeEach(() => {
    supabaseState.user = null;
    process.env.BYPASS_AUTH = "false";
  });

  it("uses the shared login page for unauthenticated FnB users", async () => {
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("https://fnb.onebiz.com.vn/"));

    expect(response.headers.get("location")).toBe(
      "https://fnb.onebiz.com.vn/dang-nhap?redirect=%2F",
    );
  });

  it("keeps FnB login shared and returns signed-in users to the clean FnB home", async () => {
    supabaseState.user = { id: "user-1" };
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(
      makeRequest("https://fnb.onebiz.com.vn/dang-nhap"),
    );

    expect(response.headers.get("location")).toBe("https://fnb.onebiz.com.vn/");
  });

  it("serves POS FnB behind the clean FnB home URL", async () => {
    supabaseState.user = { id: "user-1" };
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("https://fnb.onebiz.com.vn/"));

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://fnb.onebiz.com.vn/pos/fnb",
    );
    expect(response.headers.get("x-fnb-subdomain")).toBe("1");
  });

  it("does not change the main OneBiz login destination", async () => {
    supabaseState.user = { id: "user-1" };
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(
      makeRequest("https://onebiz.com.vn/dang-nhap"),
    );

    expect(response.headers.get("location")).toBe("https://onebiz.com.vn/");
  });
});
