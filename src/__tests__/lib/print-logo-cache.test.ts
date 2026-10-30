import { afterEach, describe, expect, it, vi } from "vitest";
import { printImageData } from "@/lib/printer/print-logo-cache";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mockImage(data = "data:image/png;base64,aGVsbG8=") {
  vi.stubGlobal("FileReader", class {
    result = data;
    onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  });
  const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["logo"]) });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("bounded print logo reuse", () => {
  it("coalesces the same logo across a burst but never caches unmarked payment images", async () => {
    const fetch = mockImage();
    await Promise.all(Array.from({ length: 20 }, () => printImageData("https://logo.test/burst", true)));
    expect(fetch).toHaveBeenCalledTimes(1);
    await Promise.all([printImageData("https://qr.test/pay"), printImageData("https://qr.test/pay")]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("expires logos after one minute and isolates changed URLs", async () => {
    let now = 1000000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetch = mockImage();
    await printImageData("https://logo.test/expiry", true);
    await printImageData("https://logo.test/new-version", true);
    now += 60001;
    await printImageData("https://logo.test/expiry", true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("does not retain failures or oversized logos", async () => {
    const fetch = mockImage("data:image/png;base64," + "a".repeat(400000));
    fetch.mockRejectedValueOnce(new Error("offline"));
    await expect(printImageData("https://logo.test/retry", true)).rejects.toThrow("offline");
    await printImageData("https://logo.test/retry", true);
    await printImageData("https://logo.test/retry", true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("keeps at most four completed logos", async () => {
    const fetch = mockImage();
    for (let i = 0; i < 5; i++) await printImageData(`https://logo.test/bounded-${i}`, true);
    await printImageData("https://logo.test/bounded-0", true);
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});
