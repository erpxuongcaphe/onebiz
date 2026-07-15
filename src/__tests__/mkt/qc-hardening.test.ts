import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canConfirmReadiness,
  isMktReadinessRole,
  normalizeReadinessRole,
} from "@/lib/mkt/readiness";

const migration = readFileSync(
  resolve("supabase/migrations/00189_mkt_qc_hardening.sql"),
  "utf8",
);

function functionBody(name: string): string {
  const marker = `function public.${name}`;
  const start = migration.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const next = migration.indexOf("create or replace function public.", start + marker.length);
  return migration.slice(start, next < 0 ? migration.length : next);
}

describe("MKT QC hardening migration", () => {
  it("uses effective role, grant, and revoke permissions on the server", () => {
    const body = functionBody("user_has_permission");
    expect(body).toContain("user_permission_overrides");
    expect(body).toContain("override_type = 'grant'");
    expect(body).toContain("override_type = 'revoke'");
    expect(body).toContain("coalesce(p.is_active, true)");
  });

  it("authorizes readiness by explicit permission and branch, not job title", () => {
    const confirm = functionBody("mkt_confirm_readiness_item");
    const matcher = functionBody("mkt_can_confirm_readiness");
    expect(confirm).toContain("mkt_can_confirm_readiness");
    expect(confirm).not.toContain("v_profile.role");
    expect(matcher).toContain("mkt_readiness_permission");
    expect(matcher).toContain("p.branch_id = p_required_branch_id");
  });

  it("requires asset permission and tenant-owned upload paths", () => {
    const media = functionBody("mkt_media_register");
    const document = functionBody("mkt_document_register");
    expect(migration).toContain(
      "drop function if exists public.mkt_media_register(text, text, text, bigint, text, uuid, uuid)",
    );
    expect(migration).toContain("text, text, text, text, text, text, bigint, text, uuid, uuid");
    expect(media).toContain("'mkt.manage_assets'");
    expect(media).toContain("p_storage_path not like v_tenant::text || '/%'");
    expect(media).toContain("26214400");
    expect(media).toContain("c.tenant_id = v_tenant");
    expect(media).toContain("(p_campaign_id is null or c.campaign_id = p_campaign_id)");
    expect(document).toContain("'mkt.manage_assets'");
    expect(document).toContain("p_storage_path not like v_tenant::text || '/%'");
    expect(document).toContain("c.tenant_id = v_tenant");
  });

  it("keeps canceled dependencies and work packages actionable", () => {
    const cancel = functionBody("mkt_cancel_task");
    expect(cancel).toContain("DEPENDENCY_CANCELED");
    expect(cancel).toContain("requires_leader_action = true");
    expect(cancel).toContain("mkt_sync_work_package_status");
  });

  it("permits one active plan per package and binds reconcile to the plan", () => {
    const reconcile = functionBody("mkt_reconcile_plan_task");
    expect(migration).toContain("uq_mkt_channel_plans_active_work_package");
    expect(migration).toContain("where deleted_at is null");
    expect(reconcile).toContain("channel_plan_id = p_plan_id");
    expect(reconcile).toContain("MISSING_REASON");
  });

  it("requires a pillar for every newly inserted content item", () => {
    const body = functionBody("mkt_require_content_pillar_on_insert");
    expect(body).toContain("MISSING_PILLAR");
    expect(migration).toContain("before insert on public.mkt_content_items");
  });
});

describe("readiness capability mapping", () => {
  it("keeps legacy responsibility values compatible", () => {
    expect(normalizeReadinessRole("owner")).toBe("ceo");
    expect(normalizeReadinessRole("manager")).toBe("store_manager");
    expect(isMktReadinessRole("owner")).toBe(true);
    expect(isMktReadinessRole("unknown")).toBe(false);
  });

  it("enforces responsibility and branch in the UI capability hint", () => {
    const context = {
      canView: true,
      branchId: "branch-a",
      readinessRoles: ["finance"],
    };
    expect(canConfirmReadiness(context, "finance", "branch-a")).toBe(true);
    expect(canConfirmReadiness(context, "finance", "branch-b")).toBe(false);
    expect(canConfirmReadiness(context, "warehouse", "branch-a")).toBe(false);
    expect(canConfirmReadiness({ ...context, canOverride: true }, "warehouse", "branch-b")).toBe(true);
  });
});
