import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editor = readFileSync(
  "src/components/shared/dialogs/create-product-dialog.tsx",
  "utf8",
);
const catalog = readFileSync("src/app/(main)/hang-hoa/page.tsx", "utf8");

describe("F&B BOM price preview", () => {
  it("does not display or save the stale Retail cost while prices load", () => {
    expect(editor).toContain("const fnbBomCostPending =");
    expect(editor).toContain('if (fnbBomCostPending) {');
    expect(editor).toContain('getBomComponentUnitPrice(componentProduct, "fnb")');
    expect(editor).toContain('getBomComponentUnitPrice(product, "fnb")');
  });

  it("labels the branch BOM action as setup, because a global BOM opens a new branch override", () => {
    expect(catalog).toContain('"Thiết lập BOM tại quán"');
    expect(catalog).toContain("const matchingBom = boms.find(");
  });
});
