import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/(main)/doi-tac/giao-hang/page.tsx", "utf8");
const service = readFileSync("src/lib/services/supabase/shipping.ts", "utf8");

describe("delivery partner list scope and layout", () => {
  it("scopes shipment metrics to the selected branch", () => {
    expect(page).toContain("{ branchId: activeBranchId }");
    expect(page).toContain("branchId={activeBranchId}");
    expect(page).toContain("Phạm vi vận đơn:");
    expect(service.match(/"invoices\.branch_id", scope\.branchId/g)?.length).toBe(2);
    expect(service).toContain('query = query.eq("invoices.branch_id", branchId)');
    expect(service).not.toContain('.eq("branch_id", branchId)');
  });

  it("uses the compact list layout and meaningful filters", () => {
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('density="compact"');
    expect(page).toContain('title="Bộ lọc đối tác giao hàng"');
    expect(page).toContain('label="Trạng thái đối tác"');
    expect(page).toContain('label="Tình hình vận chuyển"');
  });

  it("keeps the existing create, settle, edit and deactivate workflows", () => {
    expect(page).toContain("<CreateDeliveryPartnerDialog");
    expect(page).toContain("<SettleCodDialog");
    expect(page).toContain("deactivateDeliveryPartner");
    expect(page).toContain("setEditing(row.original)");
  });
});
