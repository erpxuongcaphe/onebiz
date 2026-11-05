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

export function SetupNavigation({ value, onChange, data, isCeo, settlementPeriodEnded=true }: {
  value: SetupSection; onChange: (next: SetupSection) => void;
  data: QualityWorkspace; isCeo: boolean; settlementPeriodEnded?:boolean;
}) {
  const approved = data.rules.some(rule => rule.state === "approved");
  const catalogCount=data.catalog.filter(item=>!item.ends_on||item.ends_on>=vnToday()).length;
  return <>
    <div className={s.setupStatus} role="status">
      <span>{catalogCount} tiêu chí QC chưa ngừng áp dụng tại chi nhánh</span>
      <span>{data.assignments.length ? "Đã có phân công công việc" : "Chưa có phân công công việc"}</span>
      <span>{approved ? "Đã có chính sách được duyệt" : "Chưa có chính sách điểm/thưởng được duyệt"}</span>
    </div>
    <div className={s.readiness} aria-label="Mức sẵn sàng theo nghiệp vụ">
      <button type="button" onClick={()=>requestPageLeave(()=>onChange("branch"))}><strong>Tự kiểm tra</strong><span>{catalogCount&&data.assignments.length?"Đã có công việc và phân công":"Xem công việc và phân công còn thiếu"}</span></button>
      <button type="button" onClick={()=>requestPageLeave(()=>onChange("qc"))}><strong>QC độc lập</strong><span>{catalogCount?"Đã có tiêu chuẩn · kiểm tra người QC tại Người và quyền":"Chưa có tiêu chuẩn đang áp dụng"}</span></button>
      <button type="button" onClick={()=>requestPageLeave(()=>onChange("reward"))}><strong>Chốt thưởng</strong><span>{data.score.rewardReady?(settlementPeriodEnded?"Đủ điều kiện để xem trước chốt kỳ":"Đã đủ điểm/quỹ · chờ kết thúc kỳ"):approved?"Đã có chính sách · xem điều kiện còn thiếu tại KPI":"Chưa có chính sách được duyệt"}</span></button>
    </div>
    <p className={s.muted}>Các mục thiết lập độc lập theo quyền. Chưa có chính sách thưởng không chặn công việc hằng ngày.</p>
    <nav className={s.setupNav} aria-label="Các bước thiết lập Hub">
      {setupSections.filter(section => isCeo || section.id !== "library").map(section =>
        <button key={section.id} type="button" aria-current={value === section.id ? "step" : undefined}
          onClick={() => requestPageLeave(() => onChange(section.id))}>{section.label}</button>)}
    </nav>
  </>;
}
