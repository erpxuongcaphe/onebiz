import { z } from "zod";
import source from "./ceo-workbook.json";

export const workingHeaders = ["STT", "Phân loại", "Công việc", "Tiêu chí đánh giá", "Phạm vi áp dụng", "Frequency", "Điểm"];
export const workingRowSchema = z.object({
  number: z.number().int().min(1).max(9999), group: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200), requirement: z.string().trim().min(1).max(300),
  scope: z.literal("Chung"), frequency: z.enum(["daily", "weekly"]),
  points: z.number().min(-1000).max(1000).refine((v) => v !== 0 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-8),
  critical: z.boolean().default(false), accountingRequired: z.boolean().default(false),
});
export type WorkingRow = z.infer<typeof workingRowSchema>;
export const workingImportSchema = z.object({
  requestId: z.uuid(),
  rows: z.array(workingRowSchema).min(1).max(200).refine((rows) => new Set(rows.map((row) => row.number)).size === rows.length),
  assignments: z.array(z.object({ branchId: z.uuid(), assigneeId: z.uuid() })).min(1).max(100)
    .refine((rows) => new Set(rows.map((row) => row.branchId)).size === rows.length),
  effectiveFrom: z.iso.date(), dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weeklyDay: z.number().int().min(1).max(7),
});
export function parseWorkingWorkbook(rows: unknown[][]) {
  const errors: { row: number; column: string; reason: string }[] = [];
  const result: WorkingRow[] = [];
  const headerAt = rows.findIndex((row) => row.some((cell) => String(cell ?? "").trim() === "STT"));
  const start = headerAt < 0 ? -1 : rows[headerAt].findIndex((cell) => String(cell ?? "").trim() === "STT");
  if (start < 0 || workingHeaders.some((title, col) => String(rows[headerAt]?.[start + col] ?? "").trim() !== title))
    return { rows: result, errors: [{ row: Math.max(1, headerAt + 1), column: "Tiêu đề", reason: "Cần đủ 7 cột theo mẫu công việc; hỗ trợ file gốc của CEO có hàng trống phía trên." }], notes: "" };
  const seen = new Set<number>(); let notes = "";
  rows.slice(headerAt + 1).forEach((raw, index) => {
    const cells = raw.slice(start, start + 7).map((value) => String(value ?? "").trim());
    const at = headerAt + index + 2;
    if (!cells.some(Boolean)) return;
    if (!cells[0] && cells.some((value) => value.startsWith("* Cách tính điểm:"))) { notes = cells.find((value) => value.startsWith("* Cách tính điểm:")) ?? ""; return; }
    const number = Number(cells[0]);
    const value = { number, group: cells[1], title: cells[2], requirement: cells[3], scope: cells[4],
      frequency: ({ Daily: "daily", Weekly: "weekly", "Hằng ngày": "daily", "Hằng tuần": "weekly" } as Record<string, string>)[cells[5]] ?? cells[5],
      points: /^[+−-]?\d+(\.\d{1,2})?$/.test(cells[6]) ? Number(cells[6].replace("−", "-")) : NaN,
      critical: false, accountingRequired: false };
    const parsed = workingRowSchema.safeParse(value);
    const fields = ["number", "group", "title", "requirement", "scope", "frequency", "points"];
    if (!parsed.success) for (const issue of parsed.error.issues) errors.push({ row: at, column: workingHeaders[fields.indexOf(String(issue.path[0]))] ?? "Dữ liệu", reason: "Thiếu hoặc sai giá trị. Điểm dùng số US; lịch Daily/Weekly; phạm vi Chung; tiêu chí tối đa 300 ký tự." });
    if (seen.has(number)) errors.push({ row: at, column: "STT", reason: "STT bị trùng. Không gộp theo tên công việc vì có thể cùng tên nhưng khác yêu cầu." });
    seen.add(number);
    if (parsed.success) result.push(parsed.data);
  });
  if (!result.length || result.length > 200) errors.push({ row: headerAt + 1, column: "Dữ liệu", reason: "Mỗi lần nhập từ 1 đến 200 công việc." });
  return { rows: result, errors, notes };
}
export const ceoWorkingRows: WorkingRow[] = source.rows.map((row) => workingRowSchema.parse(row));
export const ceoWorkingNotes = source.notes;
