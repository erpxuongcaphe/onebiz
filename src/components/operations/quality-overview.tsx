"use client";
import type { QualityWorkspace } from "@/lib/operations/quality-contracts";
import { formatNumber } from "@/lib/format";
import s from "./quality.module.css";

export type QualityFocus = { state?: string; result?: string; overdue?: boolean; periodOnly?: boolean };
export type QualityDestination = "work" | "issues" | "qc" | "report";
export function QualityOverview({ data, onNavigate }: { data: QualityWorkspace; onNavigate: (view: QualityDestination, focus?: QualityFocus) => void }) {
  const compliance = data.compliance;
  const issues = data.issueSummary;
  return <div className={s.overview}>
    <section className={`${s.section} ${s.complianceBand}`}>
      <h3>Tuân thủ công việc</h3>
      <strong>{compliance?.due ? `${formatNumber((compliance.met / compliance.due) * 100)}%` : "Chưa có việc đến hạn"}</strong>
      <p>{formatNumber(compliance?.met ?? 0)} đạt đúng hạn / {formatNumber(compliance?.due ?? 0)} việc đã đến hạn</p>
      {!!compliance?.late && <p>{formatNumber(compliance.late)} hoàn thành trễ, không tính thành đạt đúng hạn</p>}
      <button onClick={() => onNavigate("work", { periodOnly: true, overdue: true })}>Chưa đạt, quá hạn: {formatNumber(compliance?.overdue ?? 0)}</button>
      <button onClick={() => onNavigate("work", { periodOnly: true })}>Xem công việc trong kỳ</button>
    </section>
    <section className={`${s.section} ${s.issueBand}`}>
      <h3>Vấn đề và phối hợp</h3>
      <strong>{formatNumber(issues?.opened ?? 0)} đang mở</strong>
      <p>{formatNumber(issues?.closed ?? 0)} đã đóng theo deadline trong kỳ</p>
      <button onClick={() => onNavigate("issues", { periodOnly: true, state: "pending_review" })}>Chờ kiểm tra lại: {formatNumber(issues?.awaiting ?? 0)}</button>
      <button onClick={() => onNavigate("issues", { periodOnly: true, overdue: true })}>Quá hạn: {formatNumber(issues?.overdue ?? 0)}</button>
    </section>
    <section className={`${s.section} ${s.qualityBand}`}>
      <h3>Chất lượng QC độc lập</h3>
      <strong>{data.score?.official ? `${formatNumber(data.score.score ?? 0)} điểm` : "Chưa có điểm chính thức"}</strong>
      <p>{formatNumber(data.score?.completedAudits ?? 0)} đợt hoàn tất · {data.score?.critical ? "Có vi phạm loại thưởng" : "Chưa ghi nhận vi phạm loại thưởng"}</p>
      <button onClick={() => onNavigate("qc", {periodOnly:true})}>Xem các đợt QC</button>
      <button onClick={() => onNavigate("report")}>Đối chiếu sổ điểm và thưởng</button>
    </section>
    <section className={`${s.section} ${s.businessBand}`}>
      <h3>Kết quả kinh doanh</h3>
      <strong>{data.business?.ready ? `${formatNumber((data.business.ratioBps ?? 0) / 100)}% chỉ tiêu` : "Chưa đủ số liệu xác nhận"}</strong>
      {data.business?.ready ? <p>{formatNumber((data.business.revenueCents ?? 0)/100)} / {formatNumber((data.business.targetCents ?? 0)/100)} đồng</p> : <p>{data.business?.reason ?? "Cần chỉ tiêu và nguồn doanh thu đã duyệt."}</p>}
      <button onClick={() => onNavigate("report")}>Xem nguồn doanh thu và thưởng</button>
    </section>
  </div>;
}
