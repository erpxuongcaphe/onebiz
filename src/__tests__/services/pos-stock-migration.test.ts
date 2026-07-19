import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/00203_pos_stock_integrity.sql"),
  "utf8",
);
const retirementSql = readFileSync(
  join(process.cwd(), "supabase/migrations/00204_pos_retire_legacy_checkout.sql"),
  "utf8",
);

describe("00203 POS stock integrity migration", () => {
  it("derives actor and tenant from the authenticated session", () => {
    expect(sql).toContain("v_actor uuid := auth.uid()");
    expect(sql).toContain("v_tenant_id uuid := public.get_user_tenant_id()");
    expect(sql).toContain("public.user_has_branch_access");
    expect(sql).toContain("public.user_has_permission");
  });

  it("serializes branch checkout before stock validation and mutation", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("POS_STOCK_SHORTAGE");
    expect(sql).toContain("NVL_INSUFFICIENT");
    expect(sql).toContain("sum(");
  });

  it("uses hardened RPCs and publishes branch stock changes", () => {
    expect(sql).toContain("pos_complete_checkout_atomic_v2");
    expect(sql).toContain("complete_draft_atomic_v3");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("POS_DRAFT_ALREADY_PROCESSED");
    expect(sql).toContain("do " + "$".repeat(2));
    expect(sql).toContain("POS_PAYMENT_INVALID");
    expect(sql).toContain("POS_PAYMENT_BREAKDOWN_MISMATCH");
    expect(sql).toContain(
      "alter publication supabase_realtime add table public.branch_stock",
    );
  });

  it("keeps 00203 backward compatible during deployment", () => {
    expect(sql).not.toMatch(
      /revoke all on function public\.pos_complete_checkout_atomic\(/,
    );
    expect(sql).not.toMatch(
      /revoke all on function public\.complete_draft_atomic\(/,
    );
  });

  it("retires both legacy client RPCs only in 00204", () => {
    expect(retirementSql).toMatch(
      /revoke all on function public\.pos_complete_checkout_atomic\([\s\S]*?authenticated;/,
    );
    expect(retirementSql).toMatch(
      /revoke all on function public\.complete_draft_atomic\([\s\S]*?authenticated;/,
    );
    expect(retirementSql).toContain("to service_role");
  });
});
