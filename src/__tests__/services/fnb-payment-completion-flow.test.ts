import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
const cart = readFileSync("src/app/pos/fnb/components/fnb-cart.tsx", "utf8");

describe("FnB payment completion flow", () => {
  it("does not let receipt printing block the completed-payment UI cleanup", () => {
    const paymentFlow = page.slice(
      page.indexOf("// ── Payment ──"),
      page.indexOf("// ── Table select"),
    );

    expect(paymentFlow).toContain("void (async () => {");
    expect(paymentFlow).toContain("setPaymentOpen(false);");
    expect(paymentFlow).toContain("pos.closeTab(tab.id);");
    expect(paymentFlow).toContain('title: "Thanh toán thành công"');
  });

  it("gives the cart more room on large cashier displays and keeps order tools collapsible", () => {
    expect(cart).toContain("xl:w-[460px]");
    expect(cart).toContain("2xl:w-[520px]");
    expect(cart).toContain("Ưu đãi &amp; thao tác");
    expect(cart).toContain('!moPhanPhu && "hidden"');
  });
});
