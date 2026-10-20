import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("html2canvas", () => ({ default: mock.render }));
import { renderPrintRaster } from "@/lib/printer/raster-print";

beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
afterEach(() => { document.body.innerHTML = ""; vi.useRealTimers(); });

function loadedFrame() {
  const frame = document.querySelector("iframe")!;
  frame.contentDocument!.body.innerHTML = "<p>Phiếu thử</p>";
  frame.dispatchEvent(new Event("load"));
  return frame;
}

describe("print raster preparation deadlines", () => {
  it("cleans up the frame if font readiness never settles", async () => {
    const pending = renderPrintRaster("<p>Phiếu thử</p>", "80mm");
    const rejected = expect(pending).rejects.toThrow("phông chữ");
    const frame = document.querySelector("iframe")!;
    Object.defineProperty(frame.contentDocument!, "fonts", { value: { ready: new Promise(() => {}) } });
    loadedFrame();
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(document.querySelector("iframe")).toBeNull();
    expect(mock.render).not.toHaveBeenCalled();
  });

  it("cleans up a stalled renderer and ignores its late canvas", async () => {
    let finish!: (canvas: HTMLCanvasElement) => void;
    mock.render.mockImplementation(() => new Promise<HTMLCanvasElement>(resolve => { finish = resolve; }));
    const pending = renderPrintRaster("<p>Phiếu thử</p>", "80mm");
    const rejected = expect(pending).rejects.toThrow("chưa dựng được ảnh in");
    loadedFrame();
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    expect(mock.render).toHaveBeenCalledTimes(1);
    expect(document.querySelector("iframe")).toBeNull();
    const canvas = document.createElement("canvas");
    const read = vi.spyOn(canvas, "getContext");
    finish(canvas);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).not.toHaveBeenCalled();
  });
});
