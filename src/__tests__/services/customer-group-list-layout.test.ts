import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/(main)/khach-hang/nhom/page.tsx", "utf8");

describe("customer group list layout", () => {
  it("uses the compact list layout with useful search and filters", () => {
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('density="compact"');
    expect(page).toContain('searchPlaceholder="Theo tên nhóm, ghi chú..."');
    expect(page).toContain('title="Bộ lọc nhóm khách hàng"');
    expect(page).toContain('label="Chiết khấu mặc định"');
  });

  it("searches both group name and note", () => {
    expect(page).toContain("group.name.toLowerCase().includes(normalizedSearch)");
    expect(page).toContain('(group.note ?? "").toLowerCase().includes(normalizedSearch)');
  });

  it("keeps the existing create, update and delete workflows", () => {
    expect(page).toContain("createCustomerGroup");
    expect(page).toContain("updateCustomerGroup");
    expect(page).toContain("deleteCustomerGroup");
    expect(page).toContain("<CustomerGroupDialog");
  });
});
