import type { Standard } from "./contracts";

export interface ScheduleImpact {
  token: string;
  replaceable: { id: string; title: string; due: string }[];
  protected: { id: string; title: string; due: string }[];
  count: number;
  previousSchedule?: Standard | null;
}

export function scheduleState(standard: Standard, today: string, standards: Standard[] = []): string {
  if (["approved", "retired"].includes(standard.status) && standards.some(next =>
    next.family_id === standard.family_id && next.branch_id === standard.branch_id && next.revision > standard.revision && next.status === "approved" && next.effective_from <= today)) return "superseded";
  if (standard.status !== "approved") return standard.status;
  if (standard.stop_after && standard.stop_after < today) return "ended";
  if (standard.effective_until && standard.effective_until < today) return "ended";
  if (standard.effective_from > today) return "scheduled";
  return "active";
}

export const scheduleStateLabels: Record<string, string> = {
  active: "Đang áp dụng", scheduled: "Chưa bắt đầu", ended: "Đã kết thúc",
};
