import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("Hub custom popup positioning", () => {
  it("removes shared half-width translation before applying the Hub layout", () => {
    const classes = cn("fixed -translate-x-1/2 -translate-y-1/2", "hub-dialog translate-x-0 translate-y-0");
    expect(classes).not.toContain("-translate-x-1/2");
    expect(classes).not.toContain("-translate-y-1/2");
    expect(classes).toContain("translate-x-0");
    expect(classes).toContain("translate-y-0");
  });
  for (const file of ["quality-editor.tsx", "quality-filters.tsx", "quality-business-setup.tsx", "quality-references.tsx"]) {
    it(`${file} explicitly resets the shared popup translation`, () => {
      const source = readFileSync(resolve(process.cwd(), "src/components/operations", file), "utf8");
      const popups = source.match(/<DialogContent\b[^>]*>/g) ?? [];
      expect(popups.length).toBeGreaterThan(0);
      for (const popup of popups) {
        expect(popup).toContain("translate-x-0 translate-y-0");
      }
    });
  }
});
