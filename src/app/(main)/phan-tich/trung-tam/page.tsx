"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/contexts";
import {
  REPORT_CATALOG,
  REPORT_CATEGORIES,
  canAccessReport,
  searchReports,
  type ReportCatalogItem,
} from "@/lib/reports/catalog";
import {
  readFavoriteReportPaths,
  readRecentReportPaths,
  toggleFavoriteReportPath,
} from "@/lib/reports/preferences";
import { cn } from "@/lib/utils";

export default function ReportCenterPage() {
  const { hasPermission } = useAuth();
  const [query, setQuery] = useState("");
  const [favoritePaths, setFavoritePaths] = useState<string[]>([]);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const deferredQuery = useDeferredValue(query);

  const accessibleReports = useMemo(
    () => REPORT_CATALOG.filter((report) => canAccessReport(report, hasPermission)),
    [hasPermission],
  );
  const visibleReports = useMemo(
    () => searchReports(accessibleReports, deferredQuery),
    [accessibleReports, deferredQuery],
  );
  const favorites = accessibleReports.filter((report) =>
    favoritePaths.includes(report.href),
  );
  const recent = recentPaths
    .map((path) => accessibleReports.find((report) => report.href === path))
    .filter((report): report is ReportCatalogItem => Boolean(report));

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setFavoritePaths(readFavoriteReportPaths());
      setRecentPaths(readRecentReportPaths());
    });

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const handleFavorite = (path: string) => {
    setFavoritePaths(toggleFavoriteReportPath(path));
  };

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b border-border bg-surface-container-lowest px-4 py-5 lg:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Trung tâm báo cáo</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tìm số liệu theo nhu cầu công việc; chỉ hiển thị báo cáo tài khoản được cấp quyền.
            </p>
          </div>
          <div className="relative w-full lg:w-[420px]">
            <Icon
              name="search"
              size={19}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm báo cáo, ví dụ: khách mua sản phẩm gì"
              className="pl-10"
            />
          </div>
        </div>
      </header>

      <div className="space-y-7 px-4 py-5 lg:px-6">
        {!query && (favorites.length > 0 || recent.length > 0) ? (
          <div className="grid gap-6 xl:grid-cols-2">
            {favorites.length > 0 ? (
              <ReportList
                title="Báo cáo đã ghim"
                icon="star"
                reports={favorites}
                favoritePaths={favoritePaths}
                onFavorite={handleFavorite}
              />
            ) : null}
            {recent.length > 0 ? (
              <ReportList
                title="Mở gần đây"
                icon="history"
                reports={recent.slice(0, 5)}
                favoritePaths={favoritePaths}
                onFavorite={handleFavorite}
              />
            ) : null}
          </div>
        ) : null}

        {visibleReports.length === 0 ? (
          <div className="border-y border-border py-14 text-center">
            <Icon name="search_off" size={34} className="mx-auto text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-foreground">
              Không tìm thấy báo cáo phù hợp
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Thử từ khóa theo nghiệp vụ như doanh thu, tồn kho, khách hàng hoặc giá vốn.
            </p>
          </div>
        ) : (
          REPORT_CATEGORIES.map((category) => {
            const reports = visibleReports.filter(
              (report) => report.category === category.id,
            );
            if (reports.length === 0) return null;
            return (
              <section key={category.id} aria-labelledby={`report-category-${category.id}`}>
                <div className="mb-2 flex items-start gap-3">
                  <Icon name={category.icon} size={22} className="mt-0.5 text-primary" />
                  <div>
                    <h2
                      id={`report-category-${category.id}`}
                      className="text-base font-semibold text-foreground"
                    >
                      {category.title}
                    </h2>
                    <p className="text-xs text-muted-foreground">{category.description}</p>
                  </div>
                </div>
                <div className="grid border-y border-border md:grid-cols-2 2xl:grid-cols-3">
                  {reports.map((report) => {
                    const isFavorite = favoritePaths.includes(report.href);
                    return (
                      <div
                        key={report.href}
                        className="group flex min-w-0 items-start border-b border-border p-3 last:border-b-0 md:border-r md:[&:nth-child(2n)]:border-r-0 2xl:[&:nth-child(2n)]:border-r 2xl:[&:nth-child(3n)]:border-r-0"
                      >
                        <Link
                          href={report.href}
                          prefetch={false}
                          className="flex min-w-0 flex-1 items-start gap-3"
                        >
                          <Icon
                            name={report.icon}
                            size={21}
                            className="mt-0.5 shrink-0 text-primary"
                          />
                          <span className="min-w-0">
                            <span className="block break-words text-sm font-medium leading-5 text-foreground group-hover:text-primary">
                              {report.title}
                            </span>
                            <span className="mt-1 block text-xs leading-4 text-muted-foreground">
                              {report.description}
                            </span>
                          </span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleFavorite(report.href)}
                          className={cn(
                            "ml-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-container",
                            isFavorite ? "text-status-warning" : "text-muted-foreground",
                          )}
                          aria-label={isFavorite ? `Bỏ ghim ${report.title}` : `Ghim ${report.title}`}
                          title={isFavorite ? "Bỏ ghim" : "Ghim báo cáo"}
                        >
                          <Icon name="star" size={18} fill={isFavorite} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function ReportList({
  title,
  icon,
  reports,
  favoritePaths,
  onFavorite,
}: {
  title: string;
  icon: string;
  reports: ReportCatalogItem[];
  favoritePaths: string[];
  onFavorite: (path: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon name={icon} size={18} className="text-primary" />
        {title}
      </h2>
      <div className="divide-y divide-border border-y border-border">
        {reports.map((report) => {
          const isFavorite = favoritePaths.includes(report.href);
          return (
            <div key={report.href} className="flex items-center gap-2 py-2">
              <Link
                href={report.href}
                prefetch={false}
                className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-foreground hover:text-primary"
              >
                <Icon name={report.icon} size={18} className="shrink-0 text-primary" />
                <span className="break-words leading-5">{report.title}</span>
              </Link>
              <button
                type="button"
                onClick={() => onFavorite(report.href)}
                className={cn(
                  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-container",
                  isFavorite ? "text-status-warning" : "text-muted-foreground",
                )}
                aria-label={isFavorite ? `Bỏ ghim ${report.title}` : `Ghim ${report.title}`}
              >
                <Icon name="star" size={17} fill={isFavorite} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
