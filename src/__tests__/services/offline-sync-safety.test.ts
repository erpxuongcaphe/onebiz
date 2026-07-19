import { describe, expect, it } from "vitest";
import {
  isPosStockConflict,
  shouldRecoverSyncEntry,
} from "@/lib/offline/sync-manager";

describe("offline sync safety", () => {
  it("treats server stock shortages as terminal business conflicts", () => {
    expect(isPosStockConflict("POS_STOCK_SHORTAGE|p1|Coffee|2|0")).toBe(true);
    expect(isPosStockConflict("NVL_INSUFFICIENT|m1|Milk|3|1")).toBe(true);
    expect(isPosStockConflict("network timeout")).toBe(false);
  });

  it("recovers only stale syncing leases", () => {
    const now = Date.parse("2026-07-18T10:10:00.000Z");
    expect(
      shouldRecoverSyncEntry({ status: "syncing", lastAttempt: null }, now),
    ).toBe(true);
    expect(
      shouldRecoverSyncEntry(
        { status: "syncing", lastAttempt: "2026-07-18T10:09:00.000Z" },
        now,
      ),
    ).toBe(false);
    expect(
      shouldRecoverSyncEntry(
        { status: "syncing", lastAttempt: "2026-07-18T10:07:00.000Z" },
        now,
      ),
    ).toBe(true);
    expect(
      shouldRecoverSyncEntry({ status: "pending", lastAttempt: null }, now),
    ).toBe(false);
  });
});
