import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  resolve("src/app/(main)/phan-tich/khach-san-pham/page.tsx"),
  "utf8",
);
const service = readFileSync(
  resolve("src/lib/services/supabase/analytics.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve("supabase/migrations/00199_reporting_customer_product_scale.sql"),
  "utf8",
);

const chartSwitch = readFileSync(
  resolve("src/components/shared/report/chart-table-switch.tsx"),
  "utf8",
);
describe("báo cáo Khách hàng - Sản phẩm V5", () => {
  it("dùng tiếng Việt rõ nghĩa và ba góc nhìn phù hợp dữ liệu lớn", () => {
    expect(page).toContain('title="Khách hàng mua sản phẩm nào"');
    expect(page).toContain('label: "Theo khách hàng"');
    expect(page).toContain('label: "Mặt hàng từng khách"');
    expect(page).toContain('label: "Theo nhóm hàng"');
    expect(page).not.toMatch(/Pivot|Drill-down|heatmap/);
  });

  it("phân trang màn hình và xuất đầy đủ theo từng phần", () => {
    expect(page).toContain("PAGE_SIZE_OPTIONS");
    expect(page).toContain("getCustomerProductExportRows");
    expect(page).toContain('limit: 100');
    expect(service).toContain('p_limit: 1000');
    expect(service).toContain('if (!result.has_more || rows.length === 0) break;');
  });

  it("keeps the Supabase client as the RPC receiver", () => {
    expect(service).toContain("return rpc.call(client, name, args)");
    expect(service).not.toContain("const rpc = getClient().rpc");
  });

  it("uses compact dropdown controls and flexible report layouts", () => {
    expect(page).toContain('aria-label="Góc nhìn báo cáo"');
    expect(page).toContain('aria-label="Nội dung hiển thị"');
    expect(page).toContain('aria-label="Mật độ bảng"');
    expect(page).toContain('aria-label="Số khách trong bảng chéo"');
    expect(page).toContain('aria-label="Số nhóm hàng trong bảng chéo"');
    expect(page).toContain("MATRIX_LIMIT_OPTIONS");
    expect(page).toContain("formatMatrixLimit");
    expect(page).toContain('? "Doanh thu cao nhất"');
    expect(page).toContain('? "Nhiều đơn nhất"');
    expect(page).toContain("DropdownMenuCheckboxItem");
    expect(page).toContain('url.searchParams.set("display", displayMode)');
    expect(page).toContain('url.searchParams.set("density", density)');
    expect(page).toContain('url.searchParams.set("matrixCustomers", String(matrixCustomerLimit))');
    expect(page).toContain('url.searchParams.set("matrixCategories", String(matrixCategoryLimit))');
    expect(page).not.toContain('role="tablist"');
  });

  it("keeps visible columns aligned with the current-view export", () => {
    expect(page).toContain('customerColumns.includes("revenue")');
    expect(page).toContain('productColumns.includes("revenue")');
    expect(page).toContain("writeReportViewPreferences");
    expect(page).toContain("clearReportViewPreferences");
    expect(page).toContain('mode: "view"');
    expect(page).toContain('mode: "full"');
    expect(page).toContain("Tổng hiển thị");
    expect(page).toContain("sourceCustomerCount");
    expect(page).toContain("sourceCategoryCount");
  });

  it("uses a dropdown for chart and table selection across reports", () => {
    expect(chartSwitch).toContain('aria-label="Kiểu hiển thị báo cáo"');
    expect(chartSwitch).toContain("<Select");
    expect(chartSwitch).not.toContain('role="tablist"');
  });
  it("migration chỉ đọc và luôn kiểm tra quyền báo cáo", () => {
    expect(migration).toContain("get_customer_product_report");
    expect(migration).toContain("get_customer_product_detail_page");
    expect(migration).toContain("get_customer_product_export_page");
    expect(migration.match(/perform public\.assert_report_access/g)).toHaveLength(7);
    expect(migration).toContain("stable");
    expect(migration).toContain("cross join product_totals pt");
    expect(migration).not.toMatch(/\binsert\s+into\b/i);
    expect(migration).not.toMatch(/\bupdate\s+public\./i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration).not.toMatch(/\btruncate\b/i);
    expect(migration).not.toMatch(/\bcreate\s+trigger\b/i);
    expect(migration).not.toMatch(/\balter\s+table\b/i);
  });
});
