import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/00190_mkt_content_delete_and_read_performance.sql"),
  "utf8",
);
const controls = readFileSync(resolve("src/components/mkt/campaign-controls.tsx"), "utf8");
const campaignPage = readFileSync(
  resolve("src/app/mkt/campaigns/[campaignId]/page.tsx"),
  "utf8",
);
const requestContext = readFileSync(resolve("src/lib/mkt/request-context.ts"), "utf8");
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");

describe("MKT content deletion", () => {
  it("uses a permission-checked, tenant-scoped soft delete with audit", () => {
    expect(migration).toContain("'mkt.manage_campaigns'");
    expect(migration).toContain("'mkt.split_work_packages'");
    expect(migration).toContain("tenant_id = v_tenant");
    expect(migration).toContain("set deleted_at = now()");
    expect(migration).not.toContain("delete from public.mkt_content_items");
    expect(migration).toContain("'mkt_content_deleted'");
  });

  it("protects reviewed content and content with active tasks", () => {
    expect(migration).toContain("'pending_review', 'approved', 'published'");
    expect(migration).toContain("CONTENT_DELETE_LOCKED");
    expect(migration).toContain("CONTENT_HAS_ACTIVE_TASKS");
    expect(migration).toContain("t.task_status <> 'canceled'");
  });

  it("exposes deletion only through the permission-gated content UI", () => {
    expect(controls).toContain("export function DeleteContentButton");
    expect(controls).toContain("mktDelete(");
    expect(controls).toContain("/api/mkt/v1/contents/");
    expect(campaignPage).toContain("canManage || ctx.canSplit");
    expect(campaignPage).toContain("<DeleteContentButton");
  });
});

describe("MKT read performance", () => {
  it("deduplicates auth and permission reads per server request", () => {
    expect(requestContext).toContain('import { cache } from "react"');
    expect(requestContext).toContain("cache(async () =>");
    expect(requestContext).toContain("getMktContext(supabase)");
  });

  it("loads independent campaign detail queries in parallel", () => {
    expect(readModels).toContain(
      "const [campaignRow, wpRes, rdRes, ctRes, tkRes] = await Promise.all([",
    );
    expect(readModels).toContain("const [pillars, profiles] = await Promise.all([");
    expect(readModels).toContain("workloadByPackage");
  });
});
