import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MKT_AUDIT_SCENARIOS } from "@/lib/mkt/audit-runner";

const migration = readFileSync(
  resolve("supabase/migrations/00209_mkt_audit_runner.sql"),
  "utf8",
);
const planningPage = readFileSync(resolve("src/app/mkt/planning/page.tsx"), "utf8");
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");
const runnerPage = readFileSync(resolve("src/app/mkt/audit-runner/page.tsx"), "utf8");
const setupRoute = readFileSync(
  resolve("src/app/api/mkt/v1/audit-runner/setup/route.ts"),
  "utf8",
);

describe("MKT Audit Runner isolation", () => {
  it("defines all CEO scenarios exactly once", () => {
    expect(MKT_AUDIT_SCENARIOS).toHaveLength(10);
    expect(MKT_AUDIT_SCENARIOS.map((scenario) => scenario.key)).toEqual(
      Array.from({ length: 10 }, (_, index) => `TEST-${String(index + 1).padStart(2, "0")}`),
    );
    expect(MKT_AUDIT_SCENARIOS.every((scenario) => !scenario.name.includes("?"))).toBe(true);
  });

  it("hard-blocks real tenants and outbound delivery", () => {
    expect(migration).toContain("AUDIT_TARGET_FORBIDDEN");
    expect(migration).toContain("is_audit_sandbox");
    expect(migration).toContain("owner_tenant_id <> sandbox_tenant_id");
    expect(migration).toContain("trg_notifications_drop_mkt_audit");
    expect(migration).toContain("trg_outbox_drop_mkt_audit");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("executes backend rules and records denied mutations", () => {
    for (const rpc of [
      "mkt_start_task",
      "mkt_submit_task_review",
      "mkt_force_task_done",
      "mkt_assign_channel_planning",
      "mkt_block_task",
      "mkt_reassign_task",
      "mkt_change_campaign_status",
      "mkt_review_content",
    ]) {
      expect(migration).toContain("public." + rpc);
    }
    expect(migration).toContain("mkt_mutation_denied");
    expect(migration).toContain("mkt_task_reassigned");
  });

  it("requires an authenticated permission and creates only fake actors", () => {
    expect(runnerPage).toContain("ctx.canAuditRunner");
    expect(setupRoute).toContain("ctx.canAuditRunner");
    expect(setupRoute).toContain("@onebiz.invalid");
    expect(setupRoute).toContain("is_mkt_audit_actor: true");
    expect(setupRoute).not.toContain("NEXT_PUBLIC_SUPABASE");
    expect(setupRoute).not.toContain("serviceRoleKey");
  });
});

describe("pending work package visibility", () => {
  it("loads and renders saved packages before planning assignment", () => {
    expect(readModels).toContain("getPendingPlanningWorkPackages");
    expect(readModels).toContain('.eq("status", "needs_split")');
    expect(planningPage).toContain("getPendingPlanningWorkPackages(supabase)");
    expect(planningPage).toContain("<PendingPlanningWorkPackages");
  });
});
