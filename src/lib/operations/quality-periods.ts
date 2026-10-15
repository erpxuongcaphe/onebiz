import { z } from "zod";

export const qualityPeriodKey = z.union([
  z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  z.string().regex(/^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
]);

export interface QualityPeriod {
  key: string;
  title: string;
  starts_on: string;
  ends_on: string;
  closed: boolean;
}

export const scoringPeriodSchema = z.object({
  title: z.string().trim().min(1).max(120),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
}).superRefine((v, ctx) => {
  if (v.startsOn > v.endsOn || Date.parse(v.endsOn) - Date.parse(v.startsOn) > 366 * 86400000)
    ctx.addIssue({ code: "custom", message: "Kỳ cần đúng thứ tự ngày và không dài hơn 367 ngày." });
});

export function scoringPeriodDates(key: string, periods: readonly QualityPeriod[] = []) {
  if (!qualityPeriodKey.safeParse(key).success) throw new Error("Chọn kỳ đánh giá hợp lệ.");
  if (key.startsWith("custom:")) {
    const selected = periods.find((p) => p.key === key);
    if (!selected) throw new Error("Kỳ đánh giá không thuộc phạm vi đang xem.");
    return { from: selected.starts_on, to: selected.ends_on };
  }
  const [year, month] = key.split("-").map(Number);
  return { from: `${key}-01`, to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}
