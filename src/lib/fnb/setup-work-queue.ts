import type { FnbMenuIssue } from "@/lib/services/supabase/fnb-readiness";

export type FnbSetupIssueFilter = "all" | "price" | "recipe" | "both";

/** Each focused filter includes every issue of that kind; "both" is their intersection. */
export function matchesFnbSetupIssueFilter(issue: FnbMenuIssue, filter: FnbSetupIssueFilter) {
  if (filter === "price") return issue.missingPrice;
  if (filter === "recipe") return issue.missingBom;
  if (filter === "both") return issue.missingPrice && issue.missingBom;
  return true;
}
