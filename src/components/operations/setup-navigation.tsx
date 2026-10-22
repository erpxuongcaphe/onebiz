"use client";
import type { QualityWorkspace } from "@/lib/operations/quality-contracts";
import { requestPageLeave } from "@/lib/hooks/use-unsaved-work";
import s from "./quality.module.css";
import {vnToday} from "./quality-fields";

export const setupSections = [
  { id: "library", label: "1. Bộ tiêu chí chung" },
  { id: "branch", label: "2. Công việc chi nhánh" },
  { id: "people", label: "3. Người và quyền" },
  { id: "qc", label: "4. Tiêu chí QC" },
  { id: "reward", label: "5. Điểm và thưởng" },
  { id: "history", label: "Nhật ký" },
] as const;
export type SetupSection = (typeof setupSections)[number]["id"];

export function SetupNavigation({ value, onChange, data, isCeo }: {
  value: SetupSection; onChange: (next: SetupSection) => void;
  data: QualityWorkspace; isCeo: boolean;
}) {
  const approved = data.rules.some(rule => rule.state === "approved");
  const catalogCount=data.catalog.filter(item=>!item.ends_on||item.ends_on>=vnToday()).length;
  return <>
    <div className={s.setupStatus} role="status">
      <span>{catalogCount} tiêu chí QC chưa ngừng áp dụng tại chi nhánh</span>
      <span>{data.assignments.length ? "Đã có phân công công việc" : "Chưa có phân công công việc"}</span>
      <span>{approved ? "Đã có chính sách được duyệt" : "Chưa có chính sách điểm/thưởng được duyệt"}</span>
    </div>
    <nav className={s.setupNav} aria-label="Các bước thiết lập Hub">
      {setupSections.filter(section => isCeo || section.id !== "library").map(section =>
        <button key={section.id} type="button" aria-current={value === section.id ? "step" : undefined}
          onClick={() => requestPageLeave(() => onChange(section.id))}>{section.label}</button>)}
    </nav>
  </>;
}
