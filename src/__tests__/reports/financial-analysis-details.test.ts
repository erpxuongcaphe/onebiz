import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00260_financial_analysis_details.sql",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/reports.ts",
  "utf8",
);
const page = readFileSync(
  "src/app/(main)/phan-tich/bao-cao-tai-chinh/page.tsx",
  "utf8",
);

describe("financial analysis details", () => {
  it("uses one read-only server report for the same date and branch scope", () => {
    expect(migration).toContain(
      "public.get_financial_analysis_details_report",
    );
    expect(migration).toContain("public.assert_report_access");
    expect(migration).toContain("public.get_xnt_report");
    expect(migration).toContain("public.get_profit_and_loss_report");
    expect(migration).toContain(
      "public.get_consolidated_profit_and_loss_report",
    );
    expect(migration).toContain("coalesce(ii.unit_cost, pr.cost_price, 0)");
    expect(migration).toContain("join public.return_items");
    expect(migration).toContain("i.status = 'completed'");
  });

  it("does not write business rows", () => {
    const functionBody = migration.slice(
      migration.indexOf("create or replace function"),
      migration.indexOf("revoke all on function"),
    );
    expect(functionBody).not.toMatch(/\binsert\s+into\b/i);
    expect(functionBody).not.toMatch(/\bupdate\s+public\./i);
    expect(functionBody).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("removes the old browser-side COGS and DSO formulas", () => {
    expect(service).toContain("get_financial_analysis_details_report");
    expect(service).not.toContain("getCOGSBreakdown.invoices");
    expect(service).not.toContain("getInventoryTurnover.items");
    expect(service).not.toContain("getDSO.invoices");
  });

  it("defaults company reporting to consolidated numbers", () => {
    expect(page).toContain(
      "const [ceoView, setCeoView] = useState<boolean>(true)",
    );
    expect(page).toContain("getFinancialAnalysisDetails(");
    expect(page).toContain("fetchConsolidated && ceoView");
    expect(page).toContain("50_000");
    expect(page).toContain("4. Xu hướng biên lãi");
  });
});
