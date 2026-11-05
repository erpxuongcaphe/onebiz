"use client";
import type { QualityWorkspace } from "@/lib/operations/quality-contracts";
import { formatNumber } from "@/lib/format";
import s from "./overview.module.css";
import { OverviewWork } from "./overview-work";

export type QualityFocus = { state?: string; result?: string; overdue?: boolean; periodOnly?: boolean; search?:string; taskId?:string; preset?:"today"|"this_week"|"period"|"all" };
export type QualityDestination = "work" | "issues" | "qc" | "report" | "settings";
export function QualityOverview({ data, branch, period, people, onNavigate }: { data: QualityWorkspace; branch?:string; period?:string; people?:{id:string;name:string}[]; onNavigate: (view: QualityDestination, focus?: QualityFocus) => void }) {
  const score = data.score;
  return <>
    {branch && period && <OverviewWork key={`${branch}:${period}`} data={data} branch={branch} period={period} people={people ?? []} onNavigate={onNavigate}/>}
    <div className={s.bottom}>
      <section aria-label="QC và điểm thưởng"><h3>QC và điểm thưởng trong kỳ</h3><div className={s.rewardValues}>
        <div><span>Điểm chính thức</span><strong>{score?.official && score.score != null ? formatNumber(score.score) : "—"}</strong><small>{score?.official ? "Theo kết quả QC" : "Chưa có kết quả chính thức"}</small></div>
        <div><span>Thưởng QC {data.settlement ? "đã chốt" : "dự kiến"}</span><strong>{score?.rewardCents == null ? "—" : formatNumber(score.rewardCents / 100)}</strong><small>Đồng · chưa tạo phiếu chi</small></div>
        <div><span>Vi phạm loại thưởng</span><strong>{score?.official ? score.critical ? "Có" : "Không" : "Chưa xác định"}</strong></div>
      </div><button onClick={() => onNavigate("report")}>Đối chiếu điểm và thưởng</button></section>
      <section aria-label="Kết quả kinh doanh"><h3>Kết quả kinh doanh</h3><div className={s.rewardValues}><div><span>Mức đạt chỉ tiêu</span><strong>{data.business?.ready ? `${formatNumber((data.business.ratioBps ?? 0) / 100)}%` : "Chưa đủ số liệu xác nhận"}</strong></div></div><p>{data.business?.ready ? `${formatNumber((data.business.revenueCents ?? 0) / 100)} / ${formatNumber((data.business.targetCents ?? 0) / 100)} đồng` : data.business?.reason ?? "Cần chỉ tiêu và nguồn doanh thu đã duyệt."}</p><button onClick={() => onNavigate("report")}>Xem nguồn doanh thu và thưởng</button></section>
    </div>
    <section className={s.compliance} aria-label="Tuân thủ trong kỳ tham chiếu"><h3>Tuân thủ trong kỳ tham chiếu</h3><p>{data.compliance?.due ? `${formatNumber(data.compliance.met)} / ${formatNumber(data.compliance.due)} việc đến hạn đạt đúng hạn gốc · ${formatNumber(data.compliance.late ?? 0)} hoàn thành trễ` : "Chưa có việc đến hạn trong kỳ tham chiếu"}</p><button onClick={() => onNavigate("work", {periodOnly: true, overdue: true})}>Xem việc quá hạn cần xử lý ({formatNumber(data.compliance?.overdue ?? 0)})</button></section>
  </>;
}
