"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatNumber } from "@/lib/format";
import { canAccessReport, getReportByPath } from "@/lib/reports/catalog";
import { managementReportLink, type ManagementObservation } from "@/lib/reports/management-review";

export function canOpenManagementAction(path: string, hasPermission: (permission: string) => boolean) {
  if (path === "/tai-chinh/thu-nhap-chi-phi") return hasPermission("finance.view_cash_book");
  const report = getReportByPath(path);
  return !!report && canAccessReport(report, hasPermission);
}

export function ManagementObservationItem({ observation, branchId, range, hasPermission }: {
  observation: ManagementObservation;
  branchId?: string;
  range: { from: string; to: string };
  hasPermission: (permission: string) => boolean;
}) {
  const display = (value: number | null, unit: "money" | "count") => value === null
    ? "Chưa đủ dữ liệu" : unit === "money" ? `${formatCurrency(value)} đ` : `${formatNumber(value)} dòng`;
  return <article aria-label={observation.title} className={`min-w-0 border-l-2 py-3 pl-3 ${observation.severity === "warning" ? "border-status-warning/60" : "border-primary/40"}`}>
    <div className="flex items-start gap-2">
      <Icon name={observation.severity === "warning" ? "warning" : "info"} size={18} className={observation.severity === "warning" ? "mt-0.5 shrink-0 text-status-warning" : "mt-0.5 shrink-0 text-primary"} />
      <h3 className="text-sm font-semibold text-foreground">{observation.title}</h3>
    </div>
    <dl className="mt-3 space-y-3" aria-label="Số liệu đối chiếu">
      {observation.evidence.map(row => <div key={row.metric} className="min-w-0">
        <dt className="mb-1 text-xs font-medium text-muted-foreground">{row.metric}</dt>
        <dd className="grid min-w-0 grid-cols-1 gap-2 min-[380px]:grid-cols-3">
          {[{ label: "Kỳ này", value: row.current }, { label: "Kỳ trước", value: row.previous }, { label: "Chênh lệch", value: row.difference }].map(item => <div key={item.label} className="min-w-0">
            <span className="block text-xs text-muted-foreground">{item.label}</span>
            <span className={`block break-words text-sm tabular-nums ${item.value === null ? "text-muted-foreground" : "font-medium text-foreground"}`}>{display(item.value, row.unit)}</span>
          </div>)}
        </dd>
      </div>)}
    </dl>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">{observation.detail}</p>
    {canOpenManagementAction(observation.path, hasPermission) && <Link href={managementReportLink(observation.path, branchId, range)} className="mt-1 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary">
      {observation.action}<Icon name="arrow_forward" size={16} />
    </Link>}
  </article>;
}
