import { describe, expect, it } from "vitest";
import { settingsNav, visibleSettingsNav } from "@/components/shared/settings-nav";

describe("unified settings navigation", () => {
  it("uses one canonical link per setting and omits unfinished appearance controls", () => {
    const hrefs = settingsNav.flatMap((group) => group.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain("/cai-dat/chi-nhanh");
    expect(hrefs).toContain("/he-thong/so-do-ban");
    expect(hrefs).not.toContain("/he-thong/chi-nhanh");
    expect(hrefs).not.toContain("/cai-dat/giao-dien");
  });
  it("filters sensitive settings by existing permission and accepts either reconciliation scope", () => {
    const hrefs = visibleSettingsNav((permission) => permission === "shifts.reconcile_own_branch")
      .flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain("/he-thong/ca-cho-doi-soat");
    expect(hrefs).not.toContain("/cai-dat/phan-quyen");
    expect(hrefs).not.toContain("/he-thong/users");
    expect(hrefs).not.toContain("/he-thong/audit");
  });
});
