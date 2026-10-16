import { describe, expect, it } from "vitest";
import { referenceCriteria } from "@/lib/operations/reference-criteria";

describe("approved document reference catalogue", () => {
  it("uses all 34 CEO criteria and six source groups, without AI presets", () => {
    expect(referenceCriteria).toHaveLength(34);
    expect(
      new Set(referenceCriteria.map((item) => item.criterion.id)).size,
    ).toBe(34);
    expect(
      referenceCriteria.filter((item) => item.group === "Không gian và trải nghiệm"),
    ).toHaveLength(10);
    expect(
      new Set(referenceCriteria.map((item) => item.group)).size,
    ).toBe(6);
  });
  it("preserves contextual thresholds in full, without pretending to measure automatically", () => {
    const drinks = referenceCriteria.find(
      (item) => item.criterion.id === "ceo-ws-016",
    )!.criterion;
    expect(drinks.title).toContain("cà phê");
    expect(drinks.title).toContain("3 phút");
    expect(drinks.title).toContain("8 phút");
    expect(drinks.kind).toBe("boolean");
    expect(
      referenceCriteria.find((item) => item.criterion.id === "ceo-ws-032")!
        .criterion.title,
    ).toContain("dưới 0.7%");
  });
});
