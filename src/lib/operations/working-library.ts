import { z } from "zod";
import { workingRowSchema } from "./workbook-import";

export const libraryRowsSchema = z.array(workingRowSchema).min(1).max(200)
  .refine(rows => new Set(rows.map(row => row.number)).size === rows.length, "STT không được trùng.");
const branchSchedule = z.object({
  branchId: z.uuid(), assigneeId: z.uuid(), effectiveFrom: z.iso.date(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), weeklyDay: z.number().int().min(1).max(7),
}).strict();
export const libraryCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), requestId: z.uuid(), id: z.uuid().nullable(), version: z.number().int().positive().nullable(),
    title: z.string().trim().min(1).max(200), rows: libraryRowsSchema, notes: z.string().max(10000),
    sourceKey: z.literal("ceo-working-20261014").nullable(), reason: z.string().trim().min(5).max(1000),
  }).strict().refine(value => (value.id === null) === (value.version === null)),
  z.object({ action: z.literal("archive"), requestId: z.uuid(), id: z.uuid(), version: z.number().int().positive(),
    reason: z.string().trim().min(5).max(1000),
  }).strict(),
  z.object({ action: z.literal("restore"), requestId: z.uuid(), id: z.uuid(), version: z.number().int().positive(),
    reason: z.string().trim().min(5).max(1000),
  }).strict(),
  z.object({ action: z.literal("apply"), requestId: z.uuid(), id: z.uuid(), version: z.number().int().positive(),
    assignments: z.array(branchSchedule).min(1).max(20).refine(rows => new Set(rows.map(row => row.branchId)).size === rows.length),
  }).strict(),
]);
export type WorkingLibrary = {
  id: string; title: string; version: number; rows: z.infer<typeof libraryRowsSchema>;
  notes: string; source_key: "ceo-working-20261014" | null; archived: boolean; updated_at: string;
};
export type LibraryApplication = {
  id: string; library_id: string; library_version: number; branch_id: string;
  batch_id: string; settings: z.infer<typeof branchSchedule>; created_at: string;
};
