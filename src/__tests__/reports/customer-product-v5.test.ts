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
