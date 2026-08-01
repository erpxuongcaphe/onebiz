import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/pos/page.tsx", "utf8");

describe("retail POS online checkout gate", () => {
  it("blocks final checkout before any stock or invoice mutation while offline", () => {
    const handlerStart = page.indexOf("const handleComplete = useCallback");
    const guard = page.indexOf("if (!networkStatus.isOnline)", handlerStart);
    const submit = page.indexOf('setSubmitting("complete")', handlerStart);
    const checkout = page.indexOf("offlinePosCheckout(input", handlerStart);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(handlerStart);
    expect(guard).toBeLessThan(submit);
    expect(guard).toBeLessThan(checkout);
    expect(page).toContain("Giỏ hàng vẫn được giữ");
  });
});
