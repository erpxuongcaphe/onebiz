import { describe, expect, it } from "vitest";
import { buildInventoryCheckProductFilter } from "@/lib/inventory-check-search";

describe("inventory check product search filter", () => {
  it("keeps role, warehouse eligibility, and text match in one nested expression", () => {
    expect(buildInventoryCheckProductFilter("yaourt", false)).toBe(
      "and(or(inventory_role.is.null,inventory_role.neq.fnb_menu_item),or(product_type.eq.nvl,has_bom.is.false),or(code.ilike.%yaourt%,name.ilike.%yaourt%,barcode.ilike.%yaourt%))",
    );
  });

  it("keeps the outlet stock rule while excluding menu items", () => {
    expect(buildInventoryCheckProductFilter("NVL-SST-019", true)).toBe(
      "and(or(inventory_role.is.null,inventory_role.neq.fnb_menu_item),or(code.ilike.%NVL-SST-019%,name.ilike.%NVL-SST-019%,barcode.ilike.%NVL-SST-019%))",
    );
  });

  it("sanitizes PostgREST expression delimiters and ignores an empty query", () => {
    expect(buildInventoryCheckProductFilter(" x),role.eq.secret,%y ", false)).toBe(
      "and(or(inventory_role.is.null,inventory_role.neq.fnb_menu_item),or(product_type.eq.nvl,has_bom.is.false),or(code.ilike.%x  role.eq.secret  y%,name.ilike.%x  role.eq.secret  y%,barcode.ilike.%x  role.eq.secret  y%))",
    );
    expect(buildInventoryCheckProductFilter("  %(),  ", false)).toBeNull();
  });
});
