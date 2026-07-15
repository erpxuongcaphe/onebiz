"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/contexts";
import {
  REPORT_CATALOG,
  REPORT_CATEGORIES,
  REPORT_CENTER_PATH,
  canAccessReport,
  getReportByPath,
  searchReports,
} from "@/lib/reports/catalog";
import { rememberRecentReportPath } from "@/lib/reports/preferences";

export function ReportShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoading, hasPermission } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");

  const currentReport = getReportByPath(pathname);
  const accessibleReports = useMemo(
    () => REPORT_CATALOG.filter((report) => canAccessReport(report, hasPermission)),
    [hasPermission],
  );
  const visibleReports = useMemo(
    () => searchReports(accessibleReports, query),
    [accessibleReports, query],
  );
  const canViewPage =
    pathname === REPORT_CENTER_PATH
      ? accessibleReports.length > 0
      : currentReport
        ? canAccessReport(currentReport, hasPermission)
        : hasPermission("reports.analytics");

  useEffect(() => {
    if (currentReport && canViewPage) {
      rememberRecentReportPath(currentReport.href);
    }
  }, [canViewPage, currentReport]);

  useEffect(() => {
    if (!pickerOpen) setQuery("");
  }, [pickerOpen]);

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
        <Icon name="progress_activity" size={28} className="animate-spin" />
        <span className="ml-2 text-sm">Đang kiểm tra quyền báo cáo...</span>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
        <Icon name="lock" size={36} className="mb-3 text-muted-foreground" />
        <h1 className="text-lg font-semibold text-foreground">
          Chưa được cấp quyền xem báo cáo này
        </h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Quyền truy cập dựa trên phân quyền của tài khoản, không dựa trên chức danh.
          Hãy liên hệ quản trị viên OneBiz nếu đây là báo cáo phục vụ công việc của bạn.
        </p>
        {accessibleReports.length > 0 ? (
          <Link
            href={REPORT_CENTER_PATH}
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Icon name="analytics" size={18} />
            Mở Trung tâm báo cáo
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-container-lowest px-4 py-2 lg:px-6">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Link
            href={REPORT_CENTER_PATH}
            className="inline-flex shrink-0 items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <Icon name="analytics" size={18} />
            <span className="hidden sm:inline">Trung tâm báo cáo</span>
          </Link>
          <Icon name="chevron_right" size={16} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words font-medium leading-5 text-foreground">
            {currentReport?.shortTitle ?? "Danh mục báo cáo"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-surface-container"
          aria-label="Đổi báo cáo"
        >
          <Icon name="search" size={17} />
          <span className="hidden sm:inline">Đổi báo cáo</span>
        </button>
      </div>

      <div className="min-h-0 flex-1">{children}</div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="grid max-h-[min(760px,calc(100vh-2rem))] w-[min(760px,calc(100vw-2rem))] max-w-none grid-rows-[auto,auto,minmax(0,1fr)] gap-3 p-4">
          <DialogHeader>
            <DialogTitle>Đổi báo cáo</DialogTitle>
            <DialogDescription>
              Tìm theo tên báo cáo hoặc nhu cầu, ví dụ “khách mua gì”, “giá vốn”.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Icon
              name="search"
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm trong báo cáo..."
              className="pl-10"
              autoFocus
            />
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">
            {visibleReports.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Không tìm thấy báo cáo phù hợp.
              </div>
            ) : (
              <div className="space-y-5">
                {REPORT_CATEGORIES.map((category) => {
                  const reports = visibleReports.filter(
                    (report) => report.category === category.id,
                  );
                  if (reports.length === 0) return null;
                  return (
                    <section key={category.id}>
                      <h2 className="mb-1 px-2 text-xs font-semibold uppercase text-muted-foreground">
                        {category.title}
                      </h2>
                      <div className="divide-y divide-border rounded-lg border border-border">
                        {reports.map((report) => (
                          <Link
                            key={report.href}
                            href={report.href}
                            onClick={() => setPickerOpen(false)}
                            className="flex items-start gap-3 px-3 py-2.5 hover:bg-surface-container-low"
                          >
                            <Icon
                              name={report.icon}
                              size={20}
                              className="mt-0.5 shrink-0 text-primary"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block break-words text-sm font-medium leading-5 text-foreground">
                                {report.title}
                              </span>
                              <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                                {report.description}
                              </span>
                            </span>
                            <Icon
                              name="chevron_right"
                              size={18}
                              className="mt-0.5 shrink-0 text-muted-foreground"
                            />
                          </Link>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
