import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  "src/app/(main)/phan-tich/cong-no-aging/page.tsx",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/finance-marketing-reports.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/00257_split_receivable_payable_aging.sql",
  "utf8",
);

describe("split receivable and payable aging report", () => {
  it("shows separate receivable and payable views instead of mixing entities", () => {
    expect(page).toContain('value="receivable"');
    expect(page).toContain('value="payable"');
    expect(page).toContain("Phải thu khách hàng");
    expect(page).toContain("Phải trả nhà cung cấp");
    expect(page).toContain("getReceivableAgingReport");
    expect(page).toContain("getPayableAgingReport");
  });

  it("exports separate summary and detail sheets for both sides", () => {
    expect(page).toContain('"Tổng quan phải thu"');
    expect(page).toContain('"Chi tiết phải thu"');
    expect(page).toContain('"Tổng quan phải trả"');
    expect(page).toContain('"Chi tiết phải trả"');
  });

  it("ages each outstanding document using its stored debt", () => {
    expect(migration).toContain("coalesce(i.debt, 0) > 0");
    expect(migration).toContain("coalesce(po.debt, 0) > 0");
    expect(migration).toContain("sum(outstanding) filter");
    expect(migration).not.toContain("(i.total - i.paid) as outstanding");
  });

  it("limits payable aging to received purchase orders", () => {
    expect(migration).toContain("po.status in ('partial', 'completed')");
    expect(migration).toContain("first_received_at");
    expect(migration).toContain("sm.reference_type = 'purchase_order'");
  });

  it("keeps tenant, permission and branch checks on both report RPCs", () => {
    expect(migration.match(/assert_report_access\('reports\.analytics'/g)).toHaveLength(2);
    expect(migration.match(/assert_report_access\('reports\.view_detail'/g)).toHaveLength(2);
    expect(migration).toContain("REPORT_TENANT_SPOOF_BLOCKED");
    expect(service).toContain('"get_payable_aging_report"');
  });
});
