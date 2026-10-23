import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FnbLegacyColors } from "@/app/pos/fnb/components/fnb-legacy-colors";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.removeAttribute("data-fnb-legacy-colors");
});

describe("F&B color capability boundary", () => {
  it("leaves modern Chrome DOM and existing settings unchanged", () => {
    vi.stubGlobal("CSS", { supports: () => true });
    document.body.setAttribute("data-fnb-legacy-colors", "existing");
    const view = render(<FnbLegacyColors />);
    expect(document.body.getAttribute("data-fnb-legacy-colors")).toBe("existing");
    view.unmount();
    expect(document.body.getAttribute("data-fnb-legacy-colors")).toBe("existing");
  });
  it.each(["oklch", "color-mix"])("enables for missing %s, including body portals; cleans up when leaving POS", missing => {
    vi.stubGlobal("CSS", { supports: (_property: string, value: string) => !value.includes(missing) });
    const view = render(<FnbLegacyColors />);
    expect(document.body.getAttribute("data-fnb-legacy-colors")).toBe("true");
    view.unmount();
    expect(document.body.hasAttribute("data-fnb-legacy-colors")).toBe(false);
  });
  it("works without CSS.supports and restores prior body state", () => {
    vi.stubGlobal("CSS", undefined);
    document.body.setAttribute("data-fnb-legacy-colors", "previous");
    const view = render(<FnbLegacyColors />);
    expect(document.body.getAttribute("data-fnb-legacy-colors")).toBe("true");
    view.unmount();
    expect(document.body.getAttribute("data-fnb-legacy-colors")).toBe("previous");
  });
});
