import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("report data integrity", () => {
  const analytics = readFileSync("src/lib/services/supabase/analytics.ts", "utf8");
  const branchStock = readFileSync("src/lib/services/supabase/branch-stock.ts", "utf8");
  const inventoryPage = readFileSync(
    "src/app/(main)/phan-tich/hang-hoa/page.tsx",
    "utf8",
  );
  const reports = readFileSync("src/lib/services/supabase/reports.ts", "utf8");
  const fnbAnalytics = readFileSync(
    "src/lib/services/supabase/fnb-analytics.ts",
    "utf8",
  );
  const promotionAnalytics = readFileSync(
    "src/lib/services/supabase/promotion-analytics.ts",
    "utf8",
  );
  const abcAnalysis = readFileSync(
    "src/lib/services/supabase/abc-analysis.ts",
    "utf8",
  );
  const xntReport = readFileSync(
    "src/lib/services/supabase/xnt-report.ts",
    "utf8",
  );
  const inventoryCheckReport = readFileSync(
    "src/lib/services/supabase/inventory-check-report.ts",
    "utf8",
  );
  const production = readFileSync(
    "src/lib/services/supabase/production.ts",
    "utf8",
  );
  const lotTracePage = readFileSync(
    "src/app/(main)/phan-tich/lot-traceability/page.tsx",
    "utf8",
  );
  const customerPage = readFileSync(
    "src/app/(main)/phan-tich/khach-hang/page.tsx",
    "utf8",
  );
  const promotionPage = readFileSync(
    "src/app/(main)/phan-tich/khuyen-mai/page.tsx",
    "utf8",
  );
  const orderPage = readFileSync(
    "src/app/(main)/phan-tich/dat-hang/page.tsx",
    "utf8",
  );
  const cohortPage = readFileSync(
    "src/app/(main)/phan-tich/customer-cohort/page.tsx",
    "utf8",
  );
  const supplierPage = readFileSync(
    "src/app/(main)/phan-tich/nha-cung-cap/page.tsx",
    "utf8",
  );
  it("uses canonical branch stock for inventory KPIs and low-stock rows", () => {
    expect(analytics).toContain("getBranchStockAggregates({ branchId })");
    expect(analytics).toContain("getBranchStockRows({ branchId, lowStockOnly: true })");
    expect(analytics).not.toContain('.from("branch_inventory")');
    expect(branchStock).toContain("totalProducts: productIds.size");
  });

  it("passes the selected branch to every inventory report data source", () => {
    expect(inventoryPage).toContain("getInventoryKpis(activeBranchId, range)");
    expect(inventoryPage).toContain("getCategoryDistribution(activeBranchId)");
    expect(inventoryPage).toContain("getAnalyticsLowStock(10, activeBranchId)");
  });

  it("paginates product sales and builds movement dates from the selected range", () => {
    expect(analytics).toContain(".range(offset, offset + pageSize - 1)");
    expect(analytics).toContain("dayKeysForRange(customRange, days)");
    expect(analytics).toContain("if (!inbound.has(key)) continue");
  });
  it("paginates finance, executive, channel, and stock aggregates", () => {
    expect(analytics).toContain("fetchAllPostgrestRows");
    expect(analytics).toContain("[getFinanceKpis.currentInvoices]");
    expect(analytics).toContain("[getCrossChannelKpis]");
    expect(analytics).toContain("[getOverviewKpis.currentInvoices]");
    expect(branchStock).toContain("page.rawCount < pageSize");
    expect(branchStock).toContain(".range(offset, offset + pageSize - 1)");
  });

  it("keeps customer and supplier exports complete and branch-scoped", () => {
    expect(customerPage).toContain("loadAllCustomersForExport");
    expect(customerPage).toContain("getTopCustomersByRevenue(null");
    expect(customerPage).toContain("getTopDebtors(null, activeBranchId)");
    expect(supplierPage).toContain("getTopSuppliersByPurchase(null");
    expect(supplierPage).toContain("getSupplierSummary(null");
    expect(analytics).not.toContain("returnCount: 0");
  });

  it("keeps inventory and purchasing views aligned with the selected period", () => {
    expect(analytics).toContain("dayKeysForRange(customRange, days)");
    expect(analytics).toContain("monthKeysForRange(customRange, months)");
    expect(inventoryPage).toContain("subtitle={`${selectedPeriodLabel}");
    expect(inventoryPage).toContain("Tồn kho tại thời điểm hiện tại");
    expect(supplierPage).toContain("getPurchaseByMonth(6, activeBranchId, range)");
    expect(supplierPage).toContain("Dư nợ tại thời điểm hiện tại");
  });
  it("paginates high-volume specialist report sources", () => {
    expect(reports).toContain("fetchAllReportRows");
    expect(reports).toContain("fetchReportRowsByIds");
    expect(fnbAnalytics).toContain("fetchAllFnbRows");
    expect(promotionAnalytics).toContain("fetchAllPromotionRows");
    expect(abcAnalysis).toContain("fetchAllAbcRows");
    expect(xntReport).toContain("fetchAllXntRows");
    expect(inventoryCheckReport).toContain("fetchAllInventoryCheckRows");
    expect(production).toContain(".range(offset, offset + pageSize - 1)");
    expect(production).not.toContain(".limit(200)");
    expect(lotTracePage).toContain("fetchAll: true");
    expect(analytics).not.toContain("console.warn(context, error.message)");
    expect(fnbAnalytics).not.toContain("console.warn(context, error.message)");
  });

  it("uses the same balanced-check definition for both comparison periods", () => {
    const balancedFilters =
      inventoryCheckReport.match(/\.eq\("status", "balanced"\)/g) ?? [];
    expect(balancedFilters).toHaveLength(2);
  });
  it("keeps sales periods aligned across labels, queries, and daily buckets", () => {
    expect(promotionPage).toContain("dateRange: range");
    expect(promotionAnalytics).toContain("toCreatedAtRangeWindow(params?.dateRange)");
    expect(analytics).toContain("dayKeysForRange(customRange, days)");
    expect(orderPage).toContain("requestId !== requestIdRef.current");
    expect(orderPage).toContain("subtitle={selectedPeriodLabel}");
  });

  it("uses an explicit month selector for the cohort snapshot report", () => {
    expect(cohortPage).toContain("hideDateRange");
    expect(cohortPage).toContain('aria-label="Số tháng theo dõi"');
    expect(cohortPage).toContain("months,");
    expect(cohortPage).toContain("range: cohortRange");
  });
});
