import { describe, expect, it } from "vitest";
import {
  filterFnbProductsForBranch,
  getFnbMenuScopeFingerprint,
} from "@/lib/services/supabase/fnb-product-branch-menu";

const products = [
  { id: "global", name: "Món hiện hữu" },
  { id: "xtb-only", name: "Hồng Trà thử nghiệm" },
  { id: "other-only", name: "Món quán khác" },
  { id: "draft-at-xtb", name: "Món nháp tại XTB" },
];

const scopes = [
  { productId: "xtb-only", branchId: "xtb", mode: "only" as const },
  { productId: "other-only", branchId: "other", mode: "only" as const },
  { productId: "draft-at-xtb", branchId: "xtb", mode: "except" as const },
];

describe("FnB menu scope by branch", () => {
  it("keeps old SKUs visible when they have no explicit branch scope", () => {
    expect(filterFnbProductsForBranch(products, scopes, "xtb").map((p) => p.id)).toEqual([
      "global",
      "xtb-only",
    ]);
  });

  it("hides a scoped pilot SKU at every branch not selected", () => {
    expect(filterFnbProductsForBranch(products, scopes, "other").map((p) => p.id)).toEqual([
      "global",
      "other-only",
      "draft-at-xtb",
    ]);
  });

  it("does not reveal any branch-ruled SKU before a branch is resolved", () => {
    expect(filterFnbProductsForBranch(products, scopes, null).map((p) => p.id)).toEqual([
      "global",
    ]);
  });

  it("hides an existing SKU only at its configured draft branch", () => {
    expect(filterFnbProductsForBranch(products, scopes, "xtb").map((p) => p.id)).not.toContain(
      "draft-at-xtb",
    );
    expect(filterFnbProductsForBranch(products, scopes, "other").map((p) => p.id)).toContain(
      "draft-at-xtb",
    );
  });

  it("uses an order-independent fingerprint to invalidate a stale menu cache", () => {
    expect(getFnbMenuScopeFingerprint(scopes)).toBe(
      getFnbMenuScopeFingerprint([...scopes].reverse()),
    );
    expect(getFnbMenuScopeFingerprint(scopes)).not.toBe(
      getFnbMenuScopeFingerprint([
        { productId: "xtb-only", branchId: "xtb", mode: "only" },
      ]),
    );
  });
});
