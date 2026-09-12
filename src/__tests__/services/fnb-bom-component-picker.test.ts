import { describe, expect, it } from "vitest";
import { isSelectableFnbBomComponent } from "@/lib/fnb-bom-components";

describe("F&B BOM component policy", () => {
  it("allows Retail and legacy stock SKUs", () => {
    expect(
      isSelectableFnbBomComponent({ productType: "sku", channel: "retail" }),
    ).toBe(true);
    expect(
      isSelectableFnbBomComponent({ productType: "sku", channel: undefined }),
    ).toBe(true);
  });

  it("does not offer F&B menu items or Retail production inputs", () => {
    expect(
      isSelectableFnbBomComponent({ productType: "sku", channel: "fnb" }),
    ).toBe(false);
    expect(
      isSelectableFnbBomComponent({ productType: "nvl", channel: undefined }),
    ).toBe(false);
  });
});
