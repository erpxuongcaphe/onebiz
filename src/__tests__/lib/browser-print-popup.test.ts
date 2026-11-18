import { afterEach, describe, expect, it, vi } from "vitest";
import { printerService } from "@/lib/printer/printer-service";

function popup() {
  const doc = document.implementation.createHTMLDocument();
  const print = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({
    document: doc,
    focus: vi.fn(),
    print,
    closed: false,
  } as unknown as Window);
  return { doc, print };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("browser print dialog", () => {
  it("calls native print immediately for a document with no images", async () => {
    vi.useFakeTimers();
    const { doc, print } = popup();
    await printerService.printRaw({ rawHtml: "<p>HD009728</p>", backend: "browser" });
    expect(doc.body.textContent).toContain("HD009728");
    expect(print).toHaveBeenCalledOnce();
  });

  it("keeps the logo and opens as soon as the image loads", async () => {
    vi.useFakeTimers();
    const { doc, print } = popup();
    await printerService.printRaw({ rawHtml: '<img alt="logo" src="https://example.test/logo.png">', backend: "browser" });
    expect(print).not.toHaveBeenCalled();
    const logo = doc.images[0];
    Object.defineProperties(logo, { complete: { value: true }, naturalWidth: { value: 120 } });
    logo.dispatchEvent(new Event("load"));
    expect(print).toHaveBeenCalledOnce();
    expect(doc.images).toHaveLength(1);
    vi.runAllTimers();
    expect(print).toHaveBeenCalledOnce();
  });

  it("prints after the image deadline and keeps a screen-only notice", async () => {
    vi.useFakeTimers();
    const { doc, print } = popup();
    await printerService.printRaw({ rawHtml: '<p>HD009728</p><div class="qr-pay"><img src="https://example.test/slow.png">Quét QR</div>', backend: "browser" });
    vi.advanceTimersByTime(799);
    expect(print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(print).toHaveBeenCalledOnce();
    expect(doc.images).toHaveLength(0);
    expect(doc.querySelector(".qr-pay")).toBeNull();
    expect(doc.body.textContent).toContain("HD009728");
    expect(doc.querySelector(".print-image-notice")?.textContent).toContain("chưa tải được");
    expect(doc.head.textContent).toContain("@media print");
  });
});
