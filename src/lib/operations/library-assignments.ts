import { z } from "zod";

const ids = z.array(z.uuid()).min(1).max(200).refine(values => new Set(values.map(v => v.toLowerCase())).size === values.length);
const selection = { id:z.uuid(), branchId:z.uuid(), mode:z.enum(["add","remove","replace"]), familyIds:ids, managerIds:ids.max(20) };
export const libraryAssignmentsSchema = z.discriminatedUnion("action",[
  z.object({action:z.literal("read"),id:z.uuid(),branchId:z.uuid()}).strict(),
  z.object({action:z.literal("preview"),...selection}).strict(),
  z.object({action:z.literal("update"),...selection,token:z.string().regex(/^[a-f0-9]{32}$/),reason:z.string().trim().min(5).max(1000),requestId:z.uuid()}).strict(),
]);
export type AssignmentMode = "add"|"remove"|"replace";
export type LibraryAssignmentRow = {familyId:string;number:number;title:string;group:string;before:string[];after:string[];editable:boolean;changed:boolean};
export type LibraryAssignmentPlan = {libraryId:string;branchId:string;rows:LibraryAssignmentRow[];people:{id:string;name:string}[];token:string;changed:number};
