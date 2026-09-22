import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialog = readFileSync(
  "src/components/shared/dialogs/create-product-dialog.tsx",
  "utf8",
);
const products = readFileSync(
  "src/lib/services/supabase/products.ts",
  "utf8",
);

describe("F&B prepared stock UI", () => {
  it("offers a dedicated operator-facing type and forces it off POS", () => {
    expect(dialog).toContain("Bán thành phẩm tại quán — nấu/sơ chế rồi giữ tồn");
    expect(dialog).toContain('setIsFnbStockItem(true)');
    expect(dialog).toContain('setAllowSale(false)');
    expect(dialog).toContain('disabled={isFnbStockItem}');
  });

  it("persists and maps the explicit stock role", () => {
    expect(products).toContain(
      "is_fnb_stock_item: product.isFnbStockItem",
    );
    expect(products).toContain(
      "isFnbStockItem: row.is_fnb_stock_item ?? false",
    );
    expect(products).not.toContain('.eq("is_fnb_stock_item", false)');
  });

  it("makes category selection searchable and ordered by the operator-facing name", () => {
    expect(dialog).toContain('placeholder="Tìm tên hoặc mã nhóm"');
    expect(dialog).toContain('left.label.localeCompare(right.label, "vi"');
    expect(dialog).toContain('overflow-y-scroll');
    expect(dialog).toContain('Mã nhóm:');
  });
});
