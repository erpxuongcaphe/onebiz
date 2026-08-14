import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const doc = (path: string) => readFileSync(path, "utf8");

describe("POS FnB responsive shell", () => {
  const page = doc("src/app/pos/fnb/page.tsx");
  const loading = doc("src/app/pos/fnb/components/fnb-loading-skeleton.tsx");
  const empty = doc("src/app/pos/fnb/components/fnb-empty-branch.tsx");

  it("dung dynamic viewport height o moi trang thai cua POS", () => {
    expect(page).not.toContain("h-screen");
    expect(loading).not.toContain("h-screen");
    expect(empty).not.toContain("h-screen");
    expect(page.match(/h-dvh/g)?.length).toBeGreaterThanOrEqual(3);
    expect(loading).toContain("h-dvh");
    expect(empty).toContain("h-dvh");
  });

  it("giu nut gio hang va drawer tren vung an toan cua dien thoai", () => {
    expect(page).toContain(
      "bottom-[calc(0.75rem+env(safe-area-inset-bottom))]",
    );
    expect(page).toContain(
      "pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0",
    );
    expect(page).toContain("pb-[env(safe-area-inset-bottom)]");
  });

  it("khung cho khop breakpoint va thu tu noi dung cua giao dien that", () => {
    expect(loading).toContain("flex-wrap lg:flex-nowrap");
    expect(loading).toContain("lg:h-16 lg:py-0");
    expect(loading).toContain("flex min-h-0 flex-1 flex-col md:flex-row");
  });
});
