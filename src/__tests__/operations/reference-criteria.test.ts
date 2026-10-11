import { describe, expect, it } from "vitest";
import { referenceCriteria } from "@/lib/operations/reference-criteria";

describe("approved document reference catalogue", () => {
  it("has exactly the nineteen criteria grouped in the source document", () => {
    expect(referenceCriteria).toHaveLength(19);
    expect(
      new Set(referenceCriteria.map((item) => item.criterion.id)).size,
    ).toBe(19);
    expect(
      referenceCriteria.filter((item) => item.group === "Không gian"),
    ).toHaveLength(7);
    expect(
      referenceCriteria.filter((item) => item.group === "Con người"),
    ).toHaveLength(5);
  });
  it("does not apply the coffee timing to every beverage and keeps losses strictly below the threshold", () => {
    const drinks = referenceCriteria.find(
      (item) => item.criterion.id === "service-drinks",
    )!.criterion;
    expect(drinks.title).toContain("cà phê");
    expect(drinks.threshold).toBe(3);
    expect(
      referenceCriteria.find((item) => item.criterion.id === "goods-loss")!
        .criterion,
    ).toMatchObject({ operator: "lt", threshold: 0.7 });
  });
});
