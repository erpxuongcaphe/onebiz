"use client";

import { useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FnbMenuIssue } from "@/lib/services/supabase/fnb-readiness";

type IssueFilter = "all" | "price" | "recipe" | "both";

const FILTERS: Array<{ value: IssueFilter; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "price", label: "Thiếu giá" },
  { value: "recipe", label: "Thiếu công thức" },
  { value: "both", label: "Thiếu cả hai" },
];

function matchesFilter(issue: FnbMenuIssue, filter: IssueFilter) {
  if (filter === "price") return issue.missingPrice && !issue.missingBom;
  if (filter === "recipe") return !issue.missingPrice && issue.missingBom;
  if (filter === "both") return issue.missingPrice && issue.missingBom;
  return true;
}

export function FnbSetupWorkQueue({ issues }: { issues: FnbMenuIssue[] }) {
  const [filter, setFilter] = useState<IssueFilter>("all");
  const [query, setQuery] = useState("");
  const filteredIssues = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi-VN");
    return issues.filter((issue) => {
      if (!matchesFilter(issue, filter)) return false;
      if (!normalizedQuery) return true;
      return `${issue.code} ${issue.name} ${issue.variantName ?? ""}`
        .toLocaleLowerCase("vi-VN")
        .includes(normalizedQuery);
    });
  }, [filter, issues, query]);

  return (
    <section className="border border-border bg-surface-container-lowest" aria-label="Hàng đợi setup món FnB">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Hàng đợi setup món FnB</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Chỉ hiện món/cỡ chưa đạt. Mở từng SKU để lưu giá và công thức theo dữ liệu vận hành thực tế.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/hang-hoa/thiet-lap-gia" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Icon name="payments" size={16} className="mr-1.5" />
            Thiết lập bảng giá
          </a>
          <a href="/hang-hoa/cong-thuc" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Icon name="science" size={16} className="mr-1.5" />
            Danh sách công thức
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Lọc việc cần setup">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={cn(
                "px-2.5 py-1.5 text-xs font-medium",
                filter === item.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">{filteredIssues.length}/{issues.length} mục</span>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm mã, tên món, cỡ"
            className="h-8 w-full min-w-48 text-xs lg:w-64"
            aria-label="Tìm món cần setup"
          />
        </div>
      </div>

      {filteredIssues.length === 0 ? (
        <div className="px-3 py-8 text-center text-sm text-muted-foreground">
          Không có món nào khớp bộ lọc.
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-surface-container-low text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Mã và món</th>
                <th className="px-3 py-2 font-medium">Cỡ</th>
                <th className="px-3 py-2 font-medium">Cần hoàn thiện</th>
                <th className="px-3 py-2 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredIssues.map((issue) => (
                <tr key={issue.id}>
                  <td className="px-3 py-2 align-top">
                    <p className="font-medium">{issue.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{issue.code}</p>
                  </td>
                  <td className="px-3 py-2 align-top text-muted-foreground">{issue.variantName ?? "Một giá"}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1.5">
                      {issue.missingPrice && <span className="border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 text-xs text-status-warning">Thiếu giá</span>}
                      {issue.missingBom && <span className="border border-status-error/30 bg-status-error/10 px-1.5 py-0.5 text-xs text-status-error">Thiếu công thức</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <a
                      href={`/hang-hoa?scope=sku&search=${encodeURIComponent(issue.code)}`}
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                    >
                      Mở món <Icon name="arrow_forward" size={14} className="ml-1" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
