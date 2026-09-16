import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/00382_sales_report_drilldown_views.sql"),
  "utf8",
);
const paginationFix = readFileSync(
  resolve("supabase/migrations/00383_fix_sales_report_invoice_pagination.sql"),
  "utf8",
);
const salesPage = readFileSync(
  resolve("src/app/(main)/phan-tich/ban-hang/page.tsx"),
  "utf8",
);
const analyticsService = readFileSync(
  resolve("src/lib/services/supabase/analytics.ts"),
  "utf8",
);

describe("Sales report drill-down views", () => {
  it("keeps sales dates and return dates semantically distinct", () => {
    expect(migration).toContain("function public.get_sales_report_daily_rows");
    expect(migration).toContain("i.issued_at >= p_date_from");
    expect(migration).toContain("sr.created_at >= p_date_from");
    expect(migration).toContain("coalesce(id.gross_revenue, 0) - coalesce(rd.return_amount, 0)");
  });

  it("protects read-only drill-down RPCs with report scope checks", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("public.assert_report_access('reports.analytics', p_branch_id)");
    expect(migration).toContain("public.assert_report_access('reports.view_detail', p_branch_id)");
    expect(migration).toContain("revoke all on function public.get_sales_report_invoice_detail_page");
    expect(migration).toContain("grant execute on function public.get_sales_report_invoice_detail_page");
  });

  it("paginates invoice detail on the server", () => {
    expect(migration).toContain("p_offset integer default 0");
    expect(migration).toContain("p_limit integer default 50");
    expect(migration).toContain("offset greatest(coalesce(p_offset, 0), 0)");
    expect(migration).toContain("limit v_limit + 1");
    expect(migration).toContain("into v_rows, v_has_more");
    expect(migration).toContain("'has_more', coalesce(v_has_more, false)");
    expect(paginationFix).toContain("into v_rows, v_has_more");
    expect(paginationFix).toContain("invoice_report_pagination_fixed");
    expect(analyticsService).toContain("getSalesReportInvoiceDetailPage");
    expect(analyticsService).toContain("p_limit: Math.min(Math.max(1, limit), 200)");
  });

  it("keeps the Supabase client context when calling report RPCs", () => {
    expect(analyticsService).toContain("client.rpc.bind(client)");
  });

  it("keeps daily and invoice reporting as separate table views", () => {
    expect(salesPage).toContain('type SalesTableMode = "daily" | "invoices"');
    expect(salesPage).toContain("Theo ngày");
    expect(salesPage).toContain("Theo hóa đơn");
    expect(salesPage).toContain("getSalesReportDailyRows");
    expect(salesPage).toContain("getSalesReportInvoiceDetailPage");
  });
});
