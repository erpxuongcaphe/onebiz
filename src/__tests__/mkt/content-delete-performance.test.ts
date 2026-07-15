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
    expect(requestContext).toContain("supabase.auth.getClaims()");
    expect(requestContext).not.toContain("supabase.auth.getUser()");
    expect(requestContext).toContain("getMktContext(supabase)");
  });

  it("loads campaign detail in parallel and limits inactive tabs", () => {
    expect(readModels).toContain(
      "const [campaignRow, wpRes, rdRes, ctRes, tkRes] = await Promise.all([",
    );
    expect(readModels).toContain('activeTab === "readiness" ? 500 : 0');
    // Task ở tab khác vẫn phải lấy 1 dòng (không phải 0): bước "3. Chia việc"
    // của stepper kiểm tra detail.tasks.length > 0 — lấy 0 sẽ báo sai là
    // "chưa chia việc" dù đã chia (giống workPackages/contents dùng limit 1).
    expect(readModels).toContain('activeTab === "channels" || activeTab === "tasks" ? 1000 : 1');
    expect(readModels).toContain("workloadByPackage");
    expect(campaignPage).toContain('activeTab === "tasks" && ctx.isLead');
    expect(campaignPage).toContain('activeTab === "readiness" && ctx.canViewAudit');
    expect(campaignPage).toContain("needsMembers");
    expect(campaignPage).toContain("needsPillars");
  });
});
