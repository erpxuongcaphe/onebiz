import { z } from "zod";
import { computeListPresetRange, toCreatedAtStartIso, toCreatedAtEndExclusiveIso } from "@/lib/utils/list-date-preset-range";

export const datePresets = {
  all: "Tất cả thời gian", period: "Kỳ đang chọn", today: "Hôm nay", yesterday: "Hôm qua",
  this_week: "Tuần này", last_week: "Tuần trước", this_month: "Tháng này", last_month: "Tháng trước",
  this_quarter: "Quý này", last_quarter: "Quý trước", this_year: "Năm này", last_year: "Năm trước", custom: "Tùy chỉnh",
} as const;
export type FilterKind = "run" | "todo" | "settings";
export interface OperationsFilters {
  state: string; assignee: string; collaborator: string; category: string; priority: string;
  quality: string; verification: string; deadline: string; standard: string; frequency: string;
  scope: string; role: string; active: string; dateField: string;
  preset: keyof typeof datePresets; from: string; to: string;
}
export function initialFilters(kind: FilterKind): OperationsFilters {
  return { state: "", assignee: "", collaborator: "", category: "", priority: "", quality: "", verification: "", deadline: "", standard: "", frequency: "", scope: "", role: "", active: "", dateField: kind === "run" ? "due" : kind === "todo" ? "created" : "effective", preset: kind === "run" ? "period" : "all", from: "", to: "" };
}
export function filterDates(filters: OperationsFilters, period: string, now = new Date()) {
  if (filters.preset === "all") return { from: undefined, to: undefined };
  if (filters.preset === "custom") {
    if (!z.iso.date().safeParse(filters.from).success || !z.iso.date().safeParse(filters.to).success || filters.from > filters.to)
      throw new Error("Chọn đủ từ ngày và đến ngày; ngày bắt đầu không được sau ngày kết thúc.");
    return { from: filters.from, to: filters.to };
  }
  if (filters.preset === "period") {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Chọn kỳ hợp lệ.");
    const [year, month] = period.split("-").map(Number);
    return { from: `${period}-01`, to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
  }
  // The shared preset helper works with calendar dates in the host timezone.
  // Reconstruct Vietnam's calendar date before using it, rather than host "today".
  const vn = new Date(now.getTime() + 7 * 3600000);
  return computeListPresetRange(filters.preset, new Date(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
}
export function filterParams(filters: OperationsFilters, period: string, now = new Date()) {
  const dates = filterDates(filters, period, now);
  const params = new URLSearchParams();
  for (const key of ["state", "assignee", "collaborator", "category", "priority", "quality", "verification", "deadline", "standard", "frequency", "dateField"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (dates.from) params.set("from", toCreatedAtStartIso(dates.from)!);
  if (dates.to) params.set("to", toCreatedAtEndExclusiveIso(dates.to)!);
  return params.toString();
}
const optionalUuid = z.uuid().nullable().default(null);
export const filteredPageSchema = z.object({
  kind: z.enum(["run", "todo"]), branch: optionalUuid,
  search: z.string().max(200).default(""), mine: z.enum(["true", "false"]).default("false"),
  state: z.enum(["", "pending", "in_progress", "waiting", "done", "canceled", "transferred"]).default(""),
  assignee: optionalUuid, collaborator: optionalUuid, standard: optionalUuid,
  category: z.enum(["", "operations", "hr", "maintenance", "complaint", "food_safety", "product", "goods", "cleaning", "space", "equipment", "other"]).default(""),
  priority: z.enum(["", "important_urgent", "important", "urgent", "normal"]).default(""),
  quality: z.enum(["", "met", "unmet", "unknown"]).default(""),
  verification: z.enum(["", "verified", "unverified", "pending_review"]).default(""),
  deadline: z.enum(["", "overdue", "on_time", "late", "upcoming", "follow_up"]).default(""),
  frequency: z.enum(["", "once", "daily", "weekly", "monthly", "quarterly", "yearly", "event"]).default(""),
  dateField: z.enum(["due", "created", "completed", "verified", "follow_up"]).default("due"),
  from: z.iso.datetime({ offset: true }).nullable().default(null),
  to: z.iso.datetime({ offset: true }).nullable().default(null),
  cursorDue: z.iso.datetime({ offset: true }).nullable().default(null), cursorId: optionalUuid,
}).superRefine((value, ctx) => {
  if (!!value.cursorDue !== !!value.cursorId || (!!value.from !== !!value.to) || (value.from && value.to && Date.parse(value.from) >= Date.parse(value.to)))
    ctx.addIssue({ code: "custom", message: "Khoảng ngày hoặc trang dữ liệu không hợp lệ." });
  if (value.kind === "run" && (["created", "follow_up"].includes(value.dateField) || value.category || value.priority || value.collaborator || value.deadline === "follow_up" || ["waiting", "in_progress", "canceled"].includes(value.state)))
    ctx.addIssue({ code: "custom", message: "Bộ lọc không áp dụng cho công việc chuẩn." });
  if (value.kind === "todo" && (value.dateField === "verified" || value.quality || value.verification || value.frequency || value.standard || value.state === "transferred"))
    ctx.addIssue({ code: "custom", message: "Bộ lọc không áp dụng cho To-do." });
});

export function matchesConfiguration(item: { title?: string; assignee_id?: string; user_id?: string; status?: string; state?: string; effective_from?: string; frequency?: string; scope?: string; member_role?: string; active?: boolean }, filters: OperationsFilters, search: string, period: string) {
  const dates = filterDates(filters, period);
  return (!search || (item.title ?? "").toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"))) &&
    (!filters.assignee || (item.assignee_id ?? item.user_id) === filters.assignee) &&
    (!filters.state || (item.status ?? item.state) === filters.state) &&
    (!filters.frequency || item.frequency === filters.frequency) && (!filters.scope || item.scope === filters.scope) &&
    (!filters.role || item.member_role === filters.role) && (!filters.active || item.active === (filters.active === "true")) &&
    (!dates.from || (!!item.effective_from && item.effective_from >= dates.from && item.effective_from <= dates.to!));
}
