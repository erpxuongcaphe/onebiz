import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isMktSubdomainHost, resolveMktHref } from "@/lib/mkt/routing";

describe("MKT subdomain routing performance", () => {
  it("uses clean URLs on MKT production and staging subdomains", () => {
    expect(isMktSubdomainHost("mkthub.onebiz.com.vn")).toBe(true);
    expect(isMktSubdomainHost("mkthub-staging.onebiz.com.vn")).toBe(true);
    expect(resolveMktHref("/mkt", "")).toBe("/");
    expect(resolveMktHref("/mkt/campaigns/abc?tab=content", "")).toBe(
      "/campaigns/abc?tab=content",
    );
  });

  it("keeps internal MKT routes on the main OneBiz domain", () => {
    expect(isMktSubdomainHost("onebiz.com.vn")).toBe(false);
    expect(resolveMktHref("/mkt", "/mkt")).toBe("/mkt");
    expect(resolveMktHref("/mkt/tasks", "/mkt")).toBe("/mkt/tasks");
    expect(resolveMktHref("/api/mkt/v1/tasks", "")).toBe("/api/mkt/v1/tasks");
  });

  it("routes the shared navigation through the subdomain-aware link", () => {
    const nav = readFileSync(resolve("src/components/mkt/mkt-nav.tsx"), "utf8");
    expect(nav).toContain('import { MktLink } from "@/components/mkt/mkt-routing"');
    expect(nav).not.toContain('import Link from "next/link"');
  });
});
