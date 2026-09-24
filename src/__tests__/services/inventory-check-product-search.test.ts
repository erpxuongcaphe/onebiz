import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/components/shared/dialogs/create-inventory-check-dialog.tsx",
  "utf8",
);
const filter = readFileSync("src/lib/inventory-check-search.ts", "utf8");

describe("inventory check product search", () => {
  it("applies the combined product filter once and retains the warehouse stock rule", () => {
    expect(source).toContain("buildInventoryCheckProductFilter(term, isOutlet)");
    expect(source).toContain("q.or(productFilter)");
    expect(filter).toContain("or(inventory_role.is.null,inventory_role.neq.fnb_menu_item)");
    expect(filter).toContain("or(product_type.eq.nvl,has_bom.is.false)");
    expect(source).not.toContain('q.not("has_bom", "is", true)');
  });

  it("shows pending and failed search states instead of a false empty result", () => {
    expect(source).toContain('setProductSearchStatus("loading")');
    expect(source).toContain('productSearchStatus === "loading"');
    expect(source).toContain("Đang tìm mặt hàng...");
    expect(source).toContain('productSearchStatus === "error"');
    expect(source).toContain("Không tải được danh sách. Thử tìm lại.");
    expect(source.indexOf('productSearchStatus === "loading"')).toBeLessThan(
      source.indexOf("Không tìm thấy NVL / hàng giữ tồn phù hợp"),
    );
    expect(source).toContain("if (cancelled) return;");
  });
});
