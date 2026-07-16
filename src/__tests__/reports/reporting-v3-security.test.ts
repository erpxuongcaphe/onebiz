import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const securityMigration = readFileSync(
  resolve("supabase/migrations/00196_reporting_v3_security_scope.sql"),
  "utf8",
);
const cohortMigration = readFileSync(
  resolve("supabase/migrations/00197_customer_cohort_report.sql"),
  "utf8",
);
const aggregateMigration = readFileSync(
  resolve("supabase/migrations/00198_reporting_v3_core_aggregates.sql"),
  "utf8",
);

describe("Reporting V3 database hardening", () => {
  it("derives report authorization from the authenticated actor and effective permissions", () => {
    expect(securityMigration).toContain("v_actor_id uuid := auth.uid()");
    expect(securityMigration).toContain("public.user_has_permission");
    expect(securityMigration).toContain("public.user_has_branch_access");
    expect(securityMigration).toContain("REPORT_ALL_BRANCHES_DENIED");
    expect(securityMigration).toContain("REPORT_BRANCH_DENIED");
  });

  it("guards all ten legacy report RPC implementations", () => {
    const definitions = securityMigration.match(
      /'get_[a-z_]+_report',\r?\n\s*'[a-z, ]+'/g,
    );
    expect(definitions).toHaveLength(10);
    expect(securityMigration).toContain("_unsecured_legacy");
    expect(securityMigration).toContain(
      "perform public.assert_report_access('reports.view_detail'",
    );
  });

  it("only revokes obsolete report overloads when they still exist", () => {
    expect(securityMigration).toContain("to_regprocedure(v_signature)");
    expect(securityMigration).not.toMatch(
      /revoke all on function public\.get_staff_revenue_report\(\s*timestamptz,\s*timestamptz,\s*text,\s*uuid\s*\)/i,
    );
  });

  it("captures cost only for new invoice lines and never backfills history", () => {
    expect(securityMigration).toContain(
      "add column if not exists unit_cost numeric(15,4)",
    );
    expect(securityMigration).toContain("before insert on public.invoice_items");
    expect(securityMigration).not.toMatch(
      /update\s+public\.invoice_items\s+set\s+unit_cost/i,
    );
  });

  it("computes cohorts from all history on the server and applies branch scope", () => {
    expect(cohortMigration).toContain("min(activity_month) as first_month");
    expect(cohortMigration).toContain(
      "p_branch_id is null or i.branch_id = p_branch_id",
    );
    expect(cohortMigration).toContain(
      "public.assert_report_access('reports.analytics'",
    );
    expect(cohortMigration).not.toContain(".limit(");
  });

  it("aggregates core reports on the server without a client row cap", () => {
    expect(aggregateMigration).toContain(
      "function public.get_sales_report_summary",
    );
    expect(aggregateMigration).toContain(
      "function public.get_profit_and_loss_report",
    );
    expect(aggregateMigration).toContain("sum(ii.quantity)");
    expect(aggregateMigration).toContain("sum(ii.quantity * coalesce(ii.unit_cost");
    expect(aggregateMigration).not.toContain(".limit(");
  });

  it("requires detail-export permission and paginates full invoice exports", () => {
    expect(aggregateMigration).toContain(
      "function public.get_sales_report_invoice_page",
    );
    expect(aggregateMigration).toContain(
      "public.assert_report_access('reports.export_detail'",
    );
    expect(aggregateMigration).toContain("p_limit integer default 1000");
    expect(aggregateMigration).toContain("offset greatest(coalesce(p_offset, 0), 0)");
  });

  it("discloses legacy estimated COGS instead of rewriting history", () => {
    expect(aggregateMigration).toContain(
      "count(*) filter (where ii.unit_cost is null) as estimated_legacy_lines",
    );
    expect(aggregateMigration).toContain(
      "count(*) filter (where ii.unit_cost is not null) as snapshot_lines",
    );
    expect(aggregateMigration).not.toMatch(
      /updates+public.invoice_itemss+sets+unit_cost/i,
    );
  });


  it("nets completed returns from revenue and reverses their COGS", () => {
    expect(aggregateMigration).toContain(
      "coalesce(di.revenue, 0) - coalesce(dr.returned, 0)",
    );
    expect(aggregateMigration).toContain(
      "coalesce(i.revenue, 0) - coalesce(rr.returned, 0) as revenue",
    );
    expect(aggregateMigration).toContain(
      "coalesce(c.cogs, 0) - coalesce(rc.return_cogs, 0) as cogs",
    );
    expect(aggregateMigration).toContain(
      "join public.return_items ri on ri.return_id = sr.id",
    );
    expect(aggregateMigration).toContain("coalesce(sum(sr.total), 0)");
    expect(aggregateMigration).toContain(
      "coalesce(i.delivery_fee, 0) as delivery_fee",
    );
    expect(aggregateMigration).not.toContain("source_invoice.delivery_fee");
    expect(aggregateMigration).toContain("'Trả hàng'");
  });


  it("uses the consolidated formulas for all-branch comparison", () => {
    expect(aggregateMigration).toContain(
      "function public.get_branch_profit_and_loss_report",
    );
    expect(aggregateMigration).toContain(
      "public.assert_report_access('reports.analytics', null)",
    );
    expect(aggregateMigration).toContain(
      "total_revenue - delivery_fee - cogs - operating_expense as operating_result",
    );
  });

  it("preserves per-user grants and revokes when migrating report capabilities", () => {
    expect(securityMigration).toContain(
      "where o.override_type in ('grant', 'revoke')",
    );
    expect(securityMigration).toContain("override_type,");
    expect(securityMigration).toContain(
      "Migrated from an equivalent explicit override by 00196",
    );
  });

});
