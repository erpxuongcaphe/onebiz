import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/components/shared/dialogs/create-inventory-check-dialog.tsx",
  "utf8",
);

describe("inventory check product search", () => {
  it("keeps warehouse NVL with BOM countable without admitting BOM-backed Retail SKUs", () => {
    expect(source).toContain('.or("product_type.eq.nvl,has_bom.is.false")');
    expect(source).not.toContain('q.not("has_bom", "is", true)');
    expect(source).toContain('inventory_role.neq.fnb_menu_item');
  });
});
