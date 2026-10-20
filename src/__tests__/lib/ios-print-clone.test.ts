import { afterEach, describe, expect, it, vi } from "vitest";
import { mountIosPrintClone, type PrintCloneState } from "@/lib/printer/ios-print-clone";
import { needsIosPrintRenderer } from "@/lib/printer/raster-print";

afterEach(() => { document.querySelectorAll("iframe").forEach(frame => frame.remove()); vi.useRealTimers(); });
function fixture(): PrintCloneState {
  const doc = document.implementation.createHTMLDocument("Phiếu thử");
  doc.body.innerHTML = "<p>Cà phê sữa — Tạm tính 25.000đ</p>";
  return { documentElement: doc.documentElement, clonedReferenceElement: doc.body, scrolledElements: [], options: {} };
}

describe("isolated iOS print clone", () => {
  it("continues with a populated interactive document without waiting for load/complete", async () => {
    vi.useFakeTimers();
    const state = fixture();
    const onclone = vi.fn(); state.options.onclone = onclone;
    const pending = mountIosPrintClone(state, document, { width: 302, height: 200 });
    const frame = document.querySelector("iframe")!;
    Object.defineProperty(frame.contentDocument!, "readyState", { get: () => "interactive" });
    Object.defineProperty(frame.contentDocument!, "fonts", { value: { status: "loaded", ready: new Promise(() => {}) } });
    vi.spyOn(frame.contentWindow!, "scrollTo").mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toBe(frame);
    expect(frame.contentDocument!.body.textContent).toContain("Cà phê sữa");
    expect(onclone).toHaveBeenCalledWith(frame.contentDocument, state.clonedReferenceElement);
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
  });
  it("rejects a missing cloned target and removes the frame rather than printing blank", async () => {
    await expect(mountIosPrintClone({ ...fixture(), clonedReferenceElement: undefined }, document, { width: 302, height: 200 })).rejects.toThrow("Không tạo được");
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("rejects a document that never becomes paintable and removes its polling timer", async () => {
    vi.useFakeTimers();
    const pending = mountIosPrintClone(fixture(), document, { width: 302, height: 200 });
    Object.defineProperty(document.querySelector("iframe")!.contentDocument!, "readyState", { get: () => "loading" });
    const rejected = expect(pending).rejects.toThrow("chưa sẵn sàng");
    await vi.advanceTimersByTimeAsync(5000); await rejected;
    expect(document.querySelector("iframe")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    ["iPhone", "iPhone", 1, true], ["iPad", "iPad", 5, true],
    ["Safari", "MacIntel", 5, true], ["Safari", "MacIntel", 0, false],
    ["Chrome Windows", "Win32", 10, false], ["Chrome Android", "Linux armv8", 5, false],
  ])("selects the mobile renderer only for iOS: %s / %s", (ua, platform, touch, expected) => {
    expect(needsIosPrintRenderer(String(ua), String(platform), Number(touch))).toBe(expected);
  });
  it("loads a callable modular renderer without replacing the bundled desktop entry", async () => {
    const desktop = await import("html2canvas");
    const mobile = await import("@/lib/printer/ios-print-renderer");
    expect(typeof mobile.default).toBe("function");
    expect(mobile.default).not.toBe(desktop.default);
  });
});
