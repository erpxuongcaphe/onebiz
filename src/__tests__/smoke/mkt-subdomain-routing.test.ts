import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseState = vi.hoisted(() => ({
  subject: null as string | null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getClaims: vi.fn(async () => ({
        data: supabaseState.subject ? { claims: { sub: supabaseState.subject } } : null,
      })),
    },
  })),
}));

function makeRequest(url: string): NextRequest {
  return new NextRequest(url, {
    headers: { host: new URL(url).host },
  });
}

describe("MKT Hub subdomain routing", () => {
  beforeEach(() => {
    supabaseState.subject = null;
    process.env.BYPASS_AUTH = "false";
  });

  it("uses the shared login page for unauthenticated MKT users", async () => {
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("https://mkthub.onebiz.com.vn/"));

    expect(response.headers.get("location")).toBe(
      "https://mkthub.onebiz.com.vn/dang-nhap?redirect=%2F",
    );
  });

  it("returns signed-in users from login to the clean MKT Hub home", async () => {
    supabaseState.subject = "user-1";
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(
      makeRequest("https://mkthub.onebiz.com.vn/dang-nhap"),
    );

    expect(response.headers.get("location")).toBe("https://mkthub.onebiz.com.vn/");
  });

  it("serves /mkt behind the clean MKT Hub home URL", async () => {
    supabaseState.subject = "user-1";
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("https://mkthub.onebiz.com.vn/"));

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://mkthub.onebiz.com.vn/mkt",
    );
    expect(response.headers.get("x-mkt-subdomain")).toBe("1");
  });

  it("rewrites clean MKT deep links under the internal /mkt route", async () => {
    supabaseState.subject = "user-1";
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(
      makeRequest("https://mkthub.onebiz.com.vn/tasks/task-1"),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://mkthub.onebiz.com.vn/mkt/tasks/task-1",
    );
    expect(response.headers.get("x-mkt-subdomain")).toBe("1");
  });

  // CEO 11/07: URL trên subdomain phải sạch — /mkt/... redirect về path bỏ prefix
  it("redirects /mkt on the subdomain to the clean root URL", async () => {
    supabaseState.subject = "user-1";
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("https://mkthub.onebiz.com.vn/mkt"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://mkthub.onebiz.com.vn/");
  });

  it("redirects /mkt deep paths on the subdomain to clean URLs (keeping query)", async () => {
    supabaseState.subject = "user-1";
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(
      makeRequest("https://mkthub.onebiz.com.vn/mkt/tasks?task=abc"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://mkthub.onebiz.com.vn/tasks?task=abc",
    );
  });

  it("allows a short-lived AI audit link without an ERP session", async () => {
    const token = "a".repeat(43);
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(
      makeRequest(`https://mkthub.onebiz.com.vn/ai-audit/${token}`),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `https://mkthub.onebiz.com.vn/mkt-ai-audit/${token}`,
    );
    expect(response.headers.get("x-mkt-subdomain")).toBe("1");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("still requires login for the normal Audit Runner", async () => {
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(
      makeRequest("https://mkthub.onebiz.com.vn/audit-runner"),
    );

    expect(response.headers.get("location")).toBe(
      "https://mkthub.onebiz.com.vn/dang-nhap?redirect=%2Faudit-runner",
    );
  });

  it("does not expose AI audit links on the main OneBiz domain", async () => {
    const token = "a".repeat(43);
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(
      makeRequest(`https://onebiz.com.vn/ai-audit/${token}`),
    );

    expect(response.headers.get("location")).toBe(
      `https://onebiz.com.vn/dang-nhap?redirect=%2Fai-audit%2F${token}`,
    );
  });

  it("does not change the main OneBiz login destination", async () => {
    supabaseState.subject = "user-1";
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(
      makeRequest("https://onebiz.com.vn/dang-nhap"),
    );

    expect(response.headers.get("location")).toBe("https://onebiz.com.vn/");
  });
});