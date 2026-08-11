import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  "src/app/(main)/hang-hoa/thiet-lap-gia/page.tsx",
  "utf8",
);

describe("price tier list layout", () => {
  it("uses the compact list layout with useful search and filters", () => {
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('density="compact"');
    expect(page).toContain(
      'searchPlaceholder="Tìm tên, mã hoặc mô tả bảng giá..."',
    );
    expect(page).toContain('title="Bộ lọc bảng giá"');
    expect(page).toContain('label="Kênh áp dụng"');
    expect(page).toContain('label="Sản phẩm trong bảng giá"');
    expect(page).toContain('label="Mức ưu tiên"');
  });

  it("keeps all existing price mutation workflows", () => {
    expect(page).toContain("getPriceTierItems");
    expect(page).toContain("deletePriceTier");
    expect(page).toContain("deletePriceTierItem");
    expect(page).toContain("duplicatePriceTier");
    expect(page).toContain("<PriceTierDialog");
    expect(page).toContain("<AddPriceTierItemDialog");
    expect(page).toContain("<EditPriceTierItemDialog");
    expect(page).toContain("<BulkAddPriceTierItemsDialog");
    expect(page).toContain("<AdjustPriceTierPercentDialog");
  });
});
