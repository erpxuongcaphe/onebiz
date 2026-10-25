"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { BRANCH_TYPE_LABELS } from "@/lib/branch-type-labels";
import type { BranchPnLRow, ProfitAndLoss } from "@/lib/services/supabase/reports";
import { managementFinancialRows, managementObservations, managementReportLink } from "@/lib/reports/management-review";
import { ReportDataTable, type DataTableColumn } from "./report-data-table";
import { Icon } from "@/components/ui/icon";
import { canOpenManagementAction, ManagementObservationItem } from "./management-observation-item";

export interface ManagementReviewProps {
  current: ProfitAndLoss & { internalRevenue?: number };
  previous: ProfitAndLoss;
  branchId?: string;
  range: { from: string; to: string };
  branches?: BranchPnLRow[];
  branchError?: string | null;
  updatedAt: string;
  branchSort?: { id: string; direction: "asc" | "desc" } | null;
  onBranchSort?: (sort: { id: string; direction: "asc" | "desc" }) => void;
  hasPermission: (permission: string) => boolean;
}

const relatedReports = [
  { name: "Kết quả kinh doanh", path: "/phan-tich/bao-cao-tai-chinh", icon: "account_balance" },
  { name: "Dòng tiền", path: "/phan-tich/luong-tien", icon: "payments" },
  { name: "Công nợ", path: "/phan-tich/cong-no-aging", icon: "receipt_long" },
  { name: "Kho & giá vốn", path: "/phan-tich/xuat-nhap-ton", icon: "inventory_2" },
];

function currency(value: number | null) {
  return value === null ? "Chưa đủ dữ liệu" : `${formatCurrency(value)}đ`;
}

type FinancialRow = ReturnType<typeof managementFinancialRows>[number];
// Preserve the accounting bridge order on screen and in Excel.
const financialColumns: DataTableColumn<FinancialRow>[] = [
  { key: "metric", label: "Chỉ tiêu", sticky: true, hideable: false, sortable: false },
  { key: "current", label: "Kỳ hiện tại", align: "right", sortable: false, cell: row => currency(row.current) },
  { key: "previous", label: "Kỳ trước", align: "right", sortable: false, cell: row => currency(row.previous) },
];
const evidenceColumns: DataTableColumn<FinancialRow>[] = [
  ...financialColumns,
  { key: "difference", label: "Chênh lệch", align: "right", sortable: false, cell: row => currency(row.difference) },
];

export function ManagementReview({
  current, previous, branchId, range, branches: sourceBranches,
  branchError, updatedAt, branchSort, onBranchSort, hasPermission,
}: ManagementReviewProps) {
  const [showEvidence, setShowEvidence] = useState(false);
  const branches = useMemo(() => sourceBranches?.map(row => ({
    ...row,
    branchType: BRANCH_TYPE_LABELS[row.branchType as keyof typeof BRANCH_TYPE_LABELS] ?? row.branchType,
  })), [sourceBranches]);
  const href = (path: string, id = branchId) => managementReportLink(path, id, range);
  const rows = managementFinancialRows(current, previous);
  const observations = managementObservations(current, previous);
  const branchColumns: DataTableColumn<BranchPnLRow>[] = [
    {
      key: "branchName", label: "Chi nhánh", sticky: true, hideable: false,
      cell: row => (
        canOpenManagementAction("/phan-tich/bao-cao-tai-chinh", hasPermission) ? <Link href={href("/phan-tich/bao-cao-tai-chinh", row.branchId)} className="text-primary hover:underline">
          {row.branchName}<span className="block text-xs text-muted-foreground">{row.branchType}</span>
        </Link> : <span>{row.branchName}<span className="block text-xs text-muted-foreground">{row.branchType}</span></span>
      ),
    },
    { key: "goodsRevenue", label: "Doanh thu thuần", align: "right", cell: row => currency(row.goodsRevenue) },
    { key: "cogs", label: "Giá vốn", align: "right", sortValue: row => row.cogsComplete ? row.cogs : null, cell: row => currency(row.cogsComplete ? row.cogs : null) },
    { key: "grossProfit", label: "Lãi gộp", align: "right", sortValue: row => row.cogsComplete ? row.grossProfit : null, cell: row => currency(row.cogsComplete ? row.grossProfit : null) },
    { key: "otherIncome", label: "Thu nhập khác", align: "right", cell: row => currency(row.otherIncome ?? 0) },
    { key: "opEx", label: "Chi phí vận hành", align: "right", cell: row => currency(row.opEx) },
    { key: "netProfit", label: "Kết quả vận hành", align: "right", sortValue: row => row.cogsComplete ? row.netProfit : null, cell: row => currency(row.cogsComplete ? row.netProfit : null) },
  ];

  return (
    <section className="space-y-5 border-y border-border py-5" aria-label="Đối chiếu quản trị">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{branchId ? "Chi nhánh · gồm nội bộ" : "Toàn công ty · loại nội bộ"}</span>
        <span>Cập nhật {new Date(updatedAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
      </div>
      {!branchId && current.internalRevenue !== undefined && (
        <p className="text-sm">Doanh thu nội bộ loại trừ: <strong className="tabular-nums">{currency(current.internalRevenue)}</strong></p>
      )}
      <nav className="flex flex-wrap gap-2" aria-label="Báo cáo liên quan cùng phạm vi">
        {relatedReports.filter(item => canOpenManagementAction(item.path, hasPermission)).map(item => (
          <Link key={item.path} href={href(item.path)} className="inline-flex min-h-9 items-center gap-2 rounded border border-border px-3 text-sm text-primary hover:bg-surface-container-low">
            <Icon name={item.icon} size={17} />{item.name}
          </Link>
        ))}
      </nav>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Biến động cần xem</h2>
            <button type="button" onClick={() => setShowEvidence(value => !value)} aria-expanded={showEvidence} className="inline-flex min-h-9 items-center gap-1 text-sm text-primary">
              <Icon name={showEvidence ? "expand_less" : "expand_more"} size={18} />{showEvidence ? "Thu gọn" : "Xem bằng chứng"}
            </button>
          </div>
          <div className="divide-y divide-border">
            {observations.map(item => <ManagementObservationItem key={item.id} observation={item} branchId={branchId} range={range} hasPermission={hasPermission} />)}
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="mb-3 text-base font-semibold">Kết quả kinh doanh</h2>
          <ReportDataTable columns={financialColumns} rows={rows} getRowKey={row => row.metric} showDisplayOptions={false} tablePreferenceKey="report.management.financial-bridge" />
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Theo chứng từ đã ghi nhận. Lợi nhuận không phải dòng tiền.</p>
        </div>
      </div>
      {showEvidence && (
        <div className="min-w-0" aria-label="Bằng chứng biến động">
          <ReportDataTable columns={evidenceColumns} rows={rows} getRowKey={row => row.metric} showDisplayOptions={false} tablePreferenceKey="report.management.evidence" />
        </div>
      )}
      {!branchId && (
        <div className="min-w-0">
          <h2 className="mb-3 text-base font-semibold">Đóng góp chi nhánh</h2>
          {branchError ? <p role="alert" className="text-sm text-status-error">{branchError}</p> : branches && (
            <ReportDataTable columns={branchColumns} rows={branches} getRowKey={row => row.branchId}
              tablePreferenceKey="report.management.branches" showDisplayOptions={false}
              sortState={branchSort} onSortChange={onBranchSort} />
          )}
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Chi nhánh gồm nội bộ; tổng công ty đã loại trừ.</p>
        </div>
      )}
    </section>
  );
}
