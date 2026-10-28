"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { ReportTableFrame } from "@/components/shared/report";
import { CustomerCohortCoverage } from "./customer-cohort-coverage";
import { parseCohortEvidence, summarizeCohortEvidence, type CohortEvidence } from "@/lib/reports/cohort-evidence";
import { buildCohortEvidenceSheets } from "@/lib/reports/cohort-evidence-export";
import { exportReportToExcel } from "@/lib/utils/excel-export";

export interface CohortEvidenceRequest { actorId: string; tenantId: string; branchId: string | null; months: number }
interface Props {
  actorId: string; tenantId: string; branchId: string | null; branchLabel: string;
  allowed: boolean; canExport: boolean; canExportView?: boolean; ready?: boolean; initialMonths?: number;
  load: (request: CohortEvidenceRequest) => Promise<unknown>;
  renderHeader?: (options: { actions: ReactNode; disabled: boolean; onExportView?: () => void; onExportFull?: () => void }) => ReactNode;
}

/** Scope-bound rendering and exports for the validated read-only source. */
export function CustomerCohortEvidencePanel({ actorId, tenantId, branchId, branchLabel, allowed, canExport, canExportView = false, ready = true, initialMonths = 6, load, renderHeader }: Props) {
  const [months, setMonths] = useState(initialMonths);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ scope: string; data: CohortEvidence } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [exportFailure, setExportFailure] = useState<{ scope: string; message: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const scope = JSON.stringify([actorId, tenantId, branchId, allowed, canExport, canExportView, ready, months, revision]);
  const current = useRef(scope);
  useLayoutEffect(() => {
    current.current = scope;
    return () => { if (current.current === scope) current.current = ""; };
  }, [scope]);
  useEffect(() => {
    if (!allowed || !ready || !actorId || !tenantId) return;
    let active = true;
    load({ actorId, tenantId, branchId, months }).then(raw => {
      const data = parseCohortEvidence(raw, { tenantId, branchId, months });
      if (active && current.current === scope) setLoaded({ scope, data });
    }).catch(() => {
      if (active && current.current === scope) setFailure({ scope, message: "Không tải được báo cáo. Vui lòng thử lại." });
    });
    return () => { active = false; };
  }, [actorId, tenantId, branchId, allowed, ready, months, scope, load]);
  const data = loaded?.scope === scope ? loaded.data : undefined;
  const error = failure?.scope === scope ? failure.message : undefined;
  const downloadError = exportFailure?.scope === scope ? exportFailure.message : undefined;
  const loading = !data && !error;
  const summary = data ? summarizeCohortEvidence(data) : null;
  async function download(mode: "view" | "full") {
    if (!data || !allowed || !ready || (mode === "full" ? !canExport : !canExportView) || loading || error || exporting || current.current !== scope) return;
    setExporting(true);
    setExportFailure(null);
    try {
      const last = data.rows[data.rows.length - 1].cohort_month;
      const year = Number(last.slice(0, 4)), month = Number(last.slice(5));
      const sheets = buildCohortEvidenceSheets(data, { tenantId, branchId, months });
      await exportReportToExcel({ kind: "customer-cohort", mode, branchName: branchLabel,
        range: { from: `${data.rows[0].cohort_month}-01`, to: `${last}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}` },
        shouldSave: () => current.current === scope,
        sheets: mode === "full" ? sheets : [sheets[1]],
      });
    } catch { if (current.current === scope) setExportFailure({ scope, message: "Không xuất được báo cáo. Vui lòng thử lại." }); }
    finally { setExporting(false); }
  }
  const monthSelect = <select aria-label="Số tháng theo dõi" disabled={!ready} className="min-h-9 rounded border border-border bg-background px-2 text-sm" value={months} onChange={event => setMonths(Number(event.target.value))}>
    {[6, 12, 24].map(value => <option key={value} value={value}>{value} tháng</option>)}
  </select>;
  const disabled = !ready || loading || !!error || exporting;
  const header = renderHeader?.({ actions: monthSelect, disabled,
    onExportView: canExportView ? () => download("view") : undefined,
    onExportFull: canExport ? () => download("full") : undefined });
  if (!ready) return <>{header}<p role="status" className="p-3 text-sm text-muted-foreground">Đang kiểm tra phạm vi báo cáo...</p></>;
  if (!allowed || !actorId || !tenantId) return <p role="alert" className="p-3 text-sm text-muted-foreground">Không có quyền xem khách hàng quay lại.</p>;
  return <div className="space-y-4">
    {header ?? <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div><h1 className="text-base font-semibold text-foreground">Khách hàng quay lại</h1><p className="text-xs text-muted-foreground">{branchLabel}</p></div>
      <div className="flex items-center gap-2">{monthSelect}{canExport && <button type="button" disabled={disabled} onClick={() => download("full")} className="inline-flex min-h-9 items-center gap-2 rounded border border-border bg-background px-3 text-sm text-primary disabled:opacity-50"><Icon name="download" size={16} />{exporting ? "Đang xuất" : "Excel đầy đủ"}</button>}</div>
    </header>}
    {data && <dl className="grid grid-cols-1 gap-3 border-b border-border pb-3 sm:grid-cols-2">
      <div><dt className="text-xs text-muted-foreground">Khách lần đầu trong kỳ</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{summary?.firstTimeCustomers ?? "Chưa đủ dữ liệu"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Quay lại tháng kế</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{summary?.m1Retention === null ? "Chưa đủ dữ liệu" : `${summary?.m1Retention}%`}</dd><p className="text-xs text-muted-foreground">Bình quân nhóm đủ kỳ</p></div>
    </dl>}
    {error ? <div role="alert" className="border-l-2 border-status-error px-3 py-2 text-sm"><p>{error}</p><button type="button" className="mt-2 min-h-9 text-primary" onClick={() => setRevision(value => value + 1)}>Tải lại</button></div> : <CustomerCohortCoverage canView data={data} />}
    {downloadError && <p role="alert" className="text-sm text-status-error">{downloadError}</p>}
    {data?.retention_ready && <ReportTableFrame tablePreferenceKey="report.customer-cohort.matrix">
      <div className="overflow-x-auto border border-border"><table className="w-full border-collapse text-xs">
        <caption className="text-left text-muted-foreground">Tỷ lệ theo mã khách; tháng hiện tại chưa kết thúc.</caption>
        <thead><tr className="border-b border-border bg-primary-fixed/40"><th scope="col" className="px-3 py-2 text-left">Tháng mua đầu</th><th scope="col" className="px-3 py-2 text-right">Số khách</th>{Array.from({ length: months }, (_, index) => <th scope="col" key={index} className="min-w-[80px] px-3 py-2">{index === 0 ? "Tháng đầu" : `Tháng +${index}`}</th>)}</tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.cohort_month} className="border-b border-border"><th scope="row" className="px-3 py-2 text-left font-medium">{row.label}</th><td className="px-3 py-2 text-right tabular-nums">{row.size}</td>{Array.from({ length: months }, (_, index) => <td key={index} className="px-3 py-2 text-center tabular-nums" title={row.closed_observations[index] === false ? "Tháng đang diễn ra" : undefined}>{row.size > 0 && row.retention[index] !== undefined ? `${row.retention[index]}%` : "—"}</td>)}</tr>)}</tbody>
      </table></div>
    </ReportTableFrame>}
  </div>;
}
