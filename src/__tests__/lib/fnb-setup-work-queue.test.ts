import { describe, expect, it } from "vitest";
import { matchesFnbSetupIssueFilter } from "@/lib/fnb/setup-work-queue";
import type { FnbMenuIssue } from "@/lib/services/supabase/fnb-readiness";

function issue(missingPrice: boolean, missingBom: boolean): FnbMenuIssue {
  return { id: "id", code: "SKU", name: "Món test", missingPrice, missingBom };
}

const onlyPrice = issue(true, false);
const onlyRecipe = issue(false, true);
const both = issue(true, true);

describe("matchesFnbSetupIssueFilter", () => {
  it("bao gồm món thiếu cả hai khi lọc theo từng phần việc", () => {
    expect(matchesFnbSetupIssueFilter(onlyPrice, "price")).toBe(true);
    expect(matchesFnbSetupIssueFilter(both, "price")).toBe(true);
    expect(matchesFnbSetupIssueFilter(onlyRecipe, "recipe")).toBe(true);
    expect(matchesFnbSetupIssueFilter(both, "recipe")).toBe(true);
  });

  it("chỉ hiển thị phần giao khi lọc thiếu cả hai", () => {
    expect(matchesFnbSetupIssueFilter(onlyPrice, "both")).toBe(false);
    expect(matchesFnbSetupIssueFilter(onlyRecipe, "both")).toBe(false);
    expect(matchesFnbSetupIssueFilter(both, "both")).toBe(true);
  });
});
