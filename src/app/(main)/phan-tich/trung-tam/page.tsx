"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search, Star, X } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/contexts";
import { REPORT_CATALOG, REPORT_CATEGORIES, canAccessReport, searchReports } from "@/lib/reports/catalog";
import { readFavoriteReportPaths, readRecentReportPaths, toggleFavoriteReportPath } from "@/lib/reports/preferences";
import { cn } from "@/lib/utils";

export default function ReportCenterPage() {
  const { hasPermission } = useAuth();
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  const [favoritePaths, setFavoritePaths] = useState<string[]>([]);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const deferredQuery = useDeferredValue(query);
  const reports = useMemo(() => REPORT_CATALOG.filter((report) => canAccessReport(report, hasPermission)), [hasPermission]);
  const matching = useMemo(() => searchReports(reports, deferredQuery), [reports, deferredQuery]);
  const visible = matching.filter((report) => section === "all" ||
    (section === "favorites" ? favoritePaths.includes(report.href) :
      section === "recent" ? recentPaths.includes(report.href) : report.category === section));
  const groups = REPORT_CATEGORIES.filter((category) => reports.some((report) => report.category === category.id));
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setFavoritePaths(readFavoriteReportPaths());
      setRecentPaths(readRecentReportPaths());
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const options = [
    { id: "all", title: "Tất cả báo cáo", icon: "assessment", count: reports.length },
    { id: "favorites", title: "Đã ghim", icon: "star", count: reports.filter((report) => favoritePaths.includes(report.href)).length },
    { id: "recent", title: "Gần đây", icon: "history", count: reports.filter((report) => recentPaths.includes(report.href)).length },
    ...groups.map((category) => ({ ...category, count: reports.filter((report) => report.category === category.id).length })),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-container-lowest">
      <header className="shrink-0 border-b border-border px-4 py-4 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-foreground">Trung tâm báo cáo</h1>
          <div className="relative w-full sm:w-96">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Tìm báo cáo" placeholder="Tìm tên báo cáo hoặc nghiệp vụ…" value={query}
              onChange={(event) => setQuery(event.target.value)} className="h-10 pl-10 pr-10" />
            {query && <button type="button" aria-label="Xóa tìm kiếm" title="Xóa tìm kiếm" onClick={() => setQuery("")}
              className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><X size={16} /></button>}
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav aria-label="Nhóm báo cáo" className="shrink-0 border-b border-border bg-surface-container-low p-2 lg:w-60 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="flex gap-1 overflow-x-auto lg:flex-col">
            {options.map((option) => <button key={option.id} type="button" onClick={() => setSection(option.id)} aria-pressed={section === option.id}
              className={cn("flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full", section === option.id ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-surface-container")}>
              <Icon name={option.icon} size={18} className="shrink-0" /><span className="whitespace-nowrap lg:whitespace-normal">{option.title}</span>
              <span className="ml-auto pl-2 text-xs tabular-nums opacity-80">{option.count}</span>
            </button>)}
          </div>
        </nav>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground">{options.find((option) => option.id === section)?.title}</h2>
            <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">{visible.length} báo cáo</span>
          </div>
          {visible.length === 0 ? <div className="border-y border-border py-12 text-center text-sm text-muted-foreground">{query ? "Không tìm thấy báo cáo phù hợp" : section === "favorites" ? "Chưa có báo cáo đã ghim" : "Chưa có báo cáo trong nhóm này"}</div> :
            groups.map((category) => {
              const items = visible.filter((report) => report.category === category.id);
              if (!items.length) return null;
              return <section key={category.id} aria-labelledby={`category-${category.id}`} className="mb-6">
                <h3 id={`category-${category.id}`} className="border-b border-border bg-surface-container-low px-3 py-2 text-sm font-semibold text-foreground">{category.title}</h3>
                <div className="grid sm:grid-cols-2">
                  {items.map((report) => {
                    const pinned = favoritePaths.includes(report.href);
                    return <div key={report.href} className="group flex min-w-0 items-center gap-2 border-b border-border py-1 sm:odd:border-r">
                      <Link href={report.href} prefetch={false} className="flex min-h-20 min-w-0 flex-1 items-center gap-3 px-3 py-3 outline-none hover:bg-surface-container-low focus-visible:ring-2 focus-visible:ring-ring">
                        <Icon name={report.icon} size={22} className="shrink-0 text-primary" />
                        <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold leading-5 text-foreground group-hover:text-primary">{report.title}</span>
                          <span className="mt-1 block break-words text-sm leading-5 text-muted-foreground">{report.description}</span></span>
                        <ArrowUpRight size={16} className="shrink-0 text-muted-foreground" />
                      </Link>
                      <button type="button" aria-label={`${pinned ? "Bỏ ghim" : "Ghim"} ${report.title}`} aria-pressed={pinned} title={pinned ? "Bỏ ghim" : "Ghim báo cáo"}
                        onClick={() => setFavoritePaths(toggleFavoriteReportPath(report.href))}
                        className={cn("mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", pinned ? "text-status-warning" : "text-muted-foreground")}>
                        <Star size={18} fill={pinned ? "currentColor" : "none"} />
                      </button>
                    </div>;
                  })}
                </div>
              </section>;
            })}
        </main>
      </div>
    </div>
  );
}
