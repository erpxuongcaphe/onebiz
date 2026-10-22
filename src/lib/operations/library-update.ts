import { z } from "zod";
import type { WorkingRow } from "./workbook-import";

const selection = {
  id: z.uuid(), version: z.number().int().positive(),
  branchIds: z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
  effectiveFrom: z.iso.date(),
};
export const libraryUpdateSchema = z.discriminatedUnion("action", [
  z.object({action:z.literal("preview"),...selection}).strict(),
  z.object({action:z.literal("update"),...selection,requestId:z.uuid(),token:z.string().regex(/^[a-f0-9]{32}$/),reason:z.string().trim().min(5).max(1000)}).strict(),
]);
export type LibraryUpdatePlan = {
  libraryId:string; version:number; effectiveFrom:string; token:string;
  branches:{branchId:string;fromVersion:number;changes:{number:number;kind:"add"|"edit"|"remove";before:WorkingRow|null;after:WorkingRow|null;current?:{title:string;requirement:string;group:string;frequency:string;dueTime:string;points:number;status:string;criteria:{title:string}[];stopAfter:string|null;effectiveUntil:string|null}|null;conflict:boolean;impact:{replaceable:{id:string}[];protected:{id:string}[]}|null}[]}[];
};
export function libraryUpdateSummary(plan:LibraryUpdatePlan) {
  const changes=plan.branches.flatMap(branch=>branch.changes);
  return {added:changes.filter(row=>row.kind==="add").length,edited:changes.filter(row=>row.kind==="edit").length,
    removed:changes.filter(row=>row.kind==="remove").length,conflicts:changes.filter(row=>row.conflict).length,
    replaced:changes.reduce((sum,row)=>sum+(row.impact?.replaceable.length??0),0),
    protected:changes.reduce((sum,row)=>sum+(row.impact?.protected.length??0),0)};
}
