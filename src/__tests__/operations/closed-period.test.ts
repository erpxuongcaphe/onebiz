import { describe, expect, it } from "vitest";
import { readClosedPeriod } from "@/lib/operations/closed-period";

const snapshot = {
  target: { amount_cents: 100000, definition: { label: "Doanh thu thuần" } },
  revenue: {
    amount_cents: 120000,
    source_name: "Nguồn ngoài",
    definition: { label: "Doanh thu thuần" },
  },
  policy: { title: "Thưởng v1" },
  calculatedAt: "2026-10-01T00:00:00+07:00",
  rewards: [
    {
      userId: "manager",
      shareBps: 10000,
      state: "calculated",
      amountCents: 10000,
      scoreBps: 10000,
    },
  ],
};
describe("Closed period rendering", () => {
  it("reads frozen values, not current policy or revenue", () => {
    expect(readClosedPeriod(snapshot)?.totalCents).toBe(10000);
    expect(readClosedPeriod(snapshot)?.policy.title).toBe("Thưởng v1");
  });
  it("does not substitute live data for a missing snapshot", () =>
    expect(readClosedPeriod(null)).toBeNull());
  it("does not show malformed or unsafe monetary values", () => {
    expect(
      readClosedPeriod({
        ...snapshot,
        target: { ...snapshot.target, amount_cents: 1.25 },
      }),
    ).toBeNull();
    expect(
      readClosedPeriod({
        ...snapshot,
        rewards: [
          { ...snapshot.rewards[0], amountCents: Number.MAX_SAFE_INTEGER + 1 },
        ],
      }),
    ).toBeNull();
  });
  it("does not label unavailable rewards as complete", () =>
    expect(
      readClosedPeriod({
        ...snapshot,
        rewards: [
          { userId: "manager", state: "unavailable", reason: "Thiếu xác minh" },
        ],
      })?.complete,
    ).toBe(false));
  it("does not display an empty reward list as a finalized total", () =>
    expect(readClosedPeriod({ ...snapshot, rewards: [] })?.complete).toBe(
      false,
    ));
});
