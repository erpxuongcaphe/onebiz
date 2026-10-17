import { z } from "zod";

export const scheduleFrequencies = ["once", "daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type ScheduleFrequency = typeof scheduleFrequencies[number];
export const frequencyLabels: Record<ScheduleFrequency | "event", string> = {
  once: "Một lần", daily: "Hằng ngày", weekly: "Hằng tuần", monthly: "Hằng tháng",
  quarterly: "Hằng quý", yearly: "Hằng năm", event: "Khi phát sinh",
};
export const recurrenceSchema = z.object({
  frequency: z.enum(scheduleFrequencies), dayNumber: z.number().int().min(1).max(31).optional(),
  monthNumber: z.number().int().min(1).max(12).optional(),
}).superRefine((value,ctx)=>{
  if (value.frequency === "weekly" && value.dayNumber !== undefined && value.dayNumber > 7)
    ctx.addIssue({code:"custom",path:["dayNumber"],message:"Chọn thứ từ thứ Hai đến Chủ nhật."});
  if (["monthly","quarterly","yearly"].includes(value.frequency) && !value.dayNumber)
    ctx.addIssue({code:"custom",path:["dayNumber"],message:"Chọn ngày trong tháng."});
  if (["quarterly","yearly"].includes(value.frequency) && !value.monthNumber)
    ctx.addIssue({code:"custom",path:["monthNumber"],message:"Chọn tháng thực hiện."});
  if (value.frequency === "quarterly" && value.monthNumber !== undefined && value.monthNumber > 3)
    ctx.addIssue({code:"custom",path:["monthNumber"],message:"Chọn tháng thứ 1, 2 hoặc 3 của quý."});
});

export function scheduleSummary(frequency: string, day = 1, month = 1): string {
  if(frequency === "once") return "Một lần, không tự lặp lại";
  if(frequency === "weekly") return `Mỗi ${["thứ Hai","thứ Ba","thứ Tư","thứ Năm","thứ Sáu","thứ Bảy","Chủ nhật"][day-1] ?? "tuần"}`;
  if(frequency === "monthly") return `Ngày ${day} mỗi tháng`;
  if(frequency === "quarterly") return `Ngày ${day}, tháng thứ ${month} mỗi quý`;
  if(frequency === "yearly") return `Ngày ${day}/${month} hằng năm`;
  return frequencyLabels[frequency as keyof typeof frequencyLabels] ?? frequency;
}
