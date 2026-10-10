import { describe, expect, it, vi } from "vitest";
import { createPrinterRefresh } from "../../../public/print-point/agent.mjs";

describe("printer discovery beside the print queue", () => {
  it("returns immediately while Windows discovery is blocked and avoids duplicate scans", async () => {
    let resolveScan!: (names: string[]) => void;
    const discover = vi.fn(() => new Promise<string[]>(resolve => { resolveScan = resolve; }));
    const heartbeat = vi.fn();
    let now = 0;
    const refresh = createPrinterRefresh(discover, heartbeat, vi.fn(), () => now);
    const pending = refresh();
    await Promise.resolve();
    expect(discover).toHaveBeenCalledTimes(1);
    expect(refresh()).toBe(pending);
    // The caller can claim/send a LAN job without waiting for enumeration.
    const claim = vi.fn().mockResolvedValue({ id: "lan-job" });
    expect(await claim()).toEqual({ id: "lan-job" });
    expect(heartbeat).not.toHaveBeenCalled();
    resolveScan(["USB printer"]);
    await pending;
    expect(heartbeat).toHaveBeenCalledWith({ printers: ["USB printer"] });
    now = 299999;
    expect(refresh()).toBeNull();
    expect(discover).toHaveBeenCalledTimes(1);
  });
  it("reports a failed refresh and retries later without blocking the queue", async () => {
    let now = 0;
    const discover = vi.fn().mockRejectedValue(new Error("discovery unavailable"));
    const report = vi.fn();
    const refresh = createPrinterRefresh(discover, vi.fn(), report, () => now);
    await refresh();
    expect(report).toHaveBeenCalledTimes(1);
    now = 29999;
    expect(refresh()).toBeNull();
    now = 30000;
    await refresh();
    expect(discover).toHaveBeenCalledTimes(2);
  });
});
