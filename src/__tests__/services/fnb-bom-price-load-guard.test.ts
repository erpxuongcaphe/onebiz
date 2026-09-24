import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editor = readFileSync(
  "src/components/shared/dialogs/create-product-dialog.tsx",
  "utf8",
);

describe("F&B BOM price preview", () => {
  it("does not display or save the stale Retail cost while prices load", () => {
    expect(editor).toContain("const fnbBomCostPending =");
    expect(editor).toContain('if (fnbBomCostPending) {');
    expect(editor).toContain('getBomComponentUnitPrice(componentProduct, "fnb")');
    expect(editor).toContain('getBomComponentUnitPrice(product, "fnb")');
  });
});
