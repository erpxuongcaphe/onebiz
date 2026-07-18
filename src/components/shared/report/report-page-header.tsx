"use client";

/**
 * ReportPageHeader — header chuẩn cho toàn bộ báo cáo phân tích.
 *
 * Pattern KiotViet (CEO 06/05/2026):
 * - Title + subtitle bên trái
 * - Right side: ChartTableSwitch + DateRangePicker + Export dropdown (2 mode)
 * - Compact: 1 row, height ~64px
 *
 * Replace `DateRangeBar` cũ (giữ lại cho backward-compat các page chưa migrate).
 */

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import type {
  DatePreset,
  DateRange,
  ReportViewMode,
} from "@/lib/types/report";
import { ReportDateRangePicker } from "./report-date-range-picker";
import { ChartTableSwitch } from "./chart-table-switch";
import { useAuth } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { ReportScopeSelector } from "./report-scope-selector";

interface ReportPageHeaderProps {
  title: string;
  subtitle?: string;
  /** Date range state */
  preset: DatePreset;
  range: DateRange;
  onPresetChange: (preset: DatePreset) => void;
  onCustomRangeChange: (range: DateRange) => void;
  /** View mode toggle (omit để ẩn toggle) */
  viewMode?: ReportViewMode;
  onViewModeChange?: (next: ReportViewMode) => void;
  /** Export handlers — provide cả 2 hoặc chỉ 1 (dropdown sẽ adapt) */
  onExportView?: () => void;
  onExportFull?: () => void;
  /** Disable export button (loading state) */
  exportDisabled?: boolean;
  /** Extra actions slot bên phải Export */
  actions?: React.ReactNode;
  /** Ẩn date range picker — dùng cho báo cáo snapshot (aging, công nợ aging).
   *  Tránh user hiểu lầm chọn ngày nhưng số không đổi. CEO 16/05/2026. */
  hideDateRange?: boolean;
  /** Hide only for pages whose rows are not branch-owned. */
  hideBranchScope?: boolean;
}

export function ReportPageHeader({
  title,
  subtitle,
  preset,
  range,
  onPresetChange,
  onCustomRangeChange,
  viewMode,
  onViewModeChange,
  onExportView,
  onExportFull,
  exportDisabled,
  actions,
  hideDateRange,
  hideBranchScope,
}: ReportPageHeaderProps) {
  const { hasPermission } = useAuth();
  const canExportView = hasPermission(PERMISSIONS.REPORTS_EXPORT);
  const canExportFull = hasPermission(PERMISSIONS.REPORTS_EXPORT_DETAIL);
  const hasExport =
    (canExportView && !!onExportView) || (canExportFull && !!onExportFull);
  const showSwitch = viewMode != null && onViewModeChange;

  return (
    <div className="bg-surface-container-lowest border-b border-border px-4 lg:px-6 py-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_auto] xl:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-6 text-foreground break-words">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 max-w-3xl text-xs leading-4 text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        <div className="-mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 pb-1 xl:mx-0 xl:justify-end xl:px-0 xl:pb-0 [&>*]:shrink-0">
          {!hideBranchScope && <ReportScopeSelector />}
          {showSwitch && (
            <ChartTableSwitch value={viewMode} onChange={onViewModeChange} />
          )}
          {!hideDateRange && (
            <ReportDateRangePicker
              preset={preset}
              range={range}
              onPresetChange={onPresetChange}
              onCustomRangeChange={onCustomRangeChange}
            />
          )}
          {hasExport && (
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={exportDisabled}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "transition-colors press-scale-sm outline-none ambient-shadow",
                  exportDisabled && "opacity-50 cursor-not-allowed",
                )}
              >
                <Icon name="download" size={14} />
                Xuất file
                <Icon name="expand_more" size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="p-1 min-w-[220px]">
                {canExportView && onExportView && (
                  <button
                    onClick={onExportView}
                    className="w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-left text-xs hover:bg-surface-container press-scale-sm"
                  >
                    <Icon
                      name="article"
                      size={16}
                      className="text-muted-foreground shrink-0 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground">
                        Xuất nội dung đang xem
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Một trang tính, đúng nội dung trên màn hình
                      </p>
                    </div>
                  </button>
                )}
                {canExportFull && onExportFull && (
                  <button
                    onClick={onExportFull}
                    className="w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-left text-xs hover:bg-surface-container press-scale-sm"
                  >
                    <Icon
                      name="library_books"
                      size={16}
                      className="text-muted-foreground shrink-0 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground">
                        Xuất báo cáo đầy đủ
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Nhiều trang tính để đối chiếu số liệu
                      </p>
                    </div>
                  </button>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
