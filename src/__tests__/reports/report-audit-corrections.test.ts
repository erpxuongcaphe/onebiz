import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
describe("report audit corrections", () => {
  it("loads all branch lots and keeps quantity units in display and export", () => {
    const page = read("src/app/(main)/phan-tich/lot-traceability/page.tsx");
    const fetch = page.split("const fetchData =")[1].split("useEffect")[0];
    expect(fetch).toContain("fetchAll: true");
    expect(fetch).not.toContain("search:");
    expect(page).toContain("lot.productName");
    expect(page).toContain("productUnit: l.productUnit");
    expect(page).toContain("currentRequest === requestId.current");
    expect(page).toContain("exportDisabled={loading || loadError}");
    expect(page).not.toContain("remainingQty: rows.reduce");
    expect(page).toContain("sortReportRows(filtered");
    expect(page).toContain("sortState={sort}");
    expect(page).toContain("onSortChange={setSort}");
    expect(page).toContain("autoFilter: true");
  });
  it("does not aggregate sales quantities across incompatible units", () => {
    const page = read("src/app/(main)/phan-tich/ban-hang/page.tsx");
    expect(page).not.toContain('key: "soldQty"');
    expect(page).toContain('label="Số hóa đơn"');
    const orders = read("src/app/(main)/phan-tich/dat-hang/page.tsx");
    expect(orders).toContain("canSumQuantity ? productRows.reduce");
  });
  it("corrects only guarded report definitions without modifying business rows", () => {
    const sql = read("supabase/migrations/00469_report_rfm_and_vietnam_time.sql");
    expect(sql).toContain("percent_rank()");
    expect(sql).toContain("Asia/Ho_Chi_Minh");
    expect(sql).toContain("Unexpected report definition");
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|grant execute)\b/i);
  });
});
