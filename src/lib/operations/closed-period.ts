import { z } from "zod";

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const definition = z.object({ label: z.string() });
const reward = z.discriminatedUnion("state", [
  z.object({
    userId: z.string(),
    shareBps: z.number().int().min(0).max(10000),
    state: z.literal("calculated"),
    amountCents: money,
    scoreBps: money,
  }),
  z.object({
    userId: z.string(),
    state: z.literal("unavailable"),
    reason: z.string(),
  }),
]);
const schema = z.object({
  target: z.object({ amount_cents: money, definition }),
  revenue: z.object({
    amount_cents: money,
    source_name: z.string(),
    definition,
  }),
  policy: z.object({ title: z.string() }),
  rewards: z.array(reward),
  calculatedAt: z.string().datetime({ offset: true }),
});

// Never fall back to mutable live data for a closed period.
export function readClosedPeriod(snapshot: unknown) {
  const parsed = schema.safeParse(snapshot);
  if (!parsed.success) return null;
  const value = parsed.data;
  const total = value.rewards.reduce(
    (sum, item) => sum + (item.state === "calculated" ? item.amountCents : 0),
    0,
  );
  if (!Number.isSafeInteger(total)) return null;
  return {
    ...value,
    totalCents: total,
    complete:
      value.rewards.length > 0 &&
      value.rewards.every((item) => item.state === "calculated"),
  };
}
