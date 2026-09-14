import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const doc = (path: string) => readFileSync(path, "utf8");

describe("POS FnB responsive shell", () => {
  const page = doc("src/app/pos/fnb/page.tsx");
  const loading = doc("src/app/pos/fnb/components/fnb-loading-skeleton.tsx");
  const empty = doc("src/app/pos/fnb/components/fnb-empty-branch.tsx");
  const cart = doc("src/app/pos/fnb/components/fnb-cart.tsx");
  const itemDialog = doc("src/app/pos/fnb/components/fnb-item-dialog.tsx");
  const paymentDialog = doc("src/app/pos/fnb/components/fnb-payment-dialog.tsx");

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

  it("man hinh thap dung mat do gon nhung van giu vung cuon va nut chinh", () => {
    expect(cart).toContain("[@media(max-height:720px)]:p-3");
    expect(cart).toContain("[@media(max-height:620px)]:overflow-y-auto");
    expect(cart).toContain('className="flex gap-2 pt-1"');

    for (const dialog of [itemDialog, paymentDialog]) {
      expect(dialog).toContain("[@media(max-height:720px)]:max-h-[calc(100dvh-0.5rem)]");
      expect(dialog).toContain("[@media(max-height:720px)]:p-4");
      expect(dialog).toContain("min-h-0 flex-1 overflow-y-auto");
    }
  });

  it("nut thao tac nhanh cua popup thanh toan van du 44px tren man cam ung", () => {
    expect(paymentDialog.match(/pointer-coarse:min-h-11/g)?.length).toBeGreaterThanOrEqual(3);
    expect(paymentDialog).toContain("flex min-h-11 flex-col items-center justify-center");
  });
});
