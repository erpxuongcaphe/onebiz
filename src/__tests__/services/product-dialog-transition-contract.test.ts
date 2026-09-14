import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productsPage = readFileSync("src/app/(main)/hang-hoa/page.tsx", "utf8");

describe("product dialog transition contract", () => {
  it("keeps edit data mounted while the dialog closes", () => {
    expect(productsPage).toContain("onOpenChange={setCreateOpen}");
    expect(productsPage).not.toContain("if (!open) setEditingProduct(null)");
  });

  it("clears stale edit data only when opening the create flow", () => {
    expect(productsPage).toMatch(
      /label: "Tạo mới",[\s\S]*?setEditingProduct\(null\);[\s\S]*?setCreateOpen\(true\);/,
    );
  });
});
