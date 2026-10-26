"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icon } from "@/components/ui/icon";
import { queryLocalList } from "@/lib/local-list-query";

type Option = { value: string; label: string };
export type ListFilter<T> = { key: string; label: string; options: Option[]; matches: (row: T, value: string) => boolean };
export type ListSort<T> = { key: string; label: string; value: (row: T) => string | number };
type Config<T> = { searchText: (row: T) => string; filters: ListFilter<T>[]; sorts: ListSort<T>[] };

/** Only for a fully loaded, already authorized collection. Server-paged lists use server query controls. */
export function useLocalList<T>(rows: T[], config: Config<T>) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState(config.sorts[0]?.key ?? "");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [requestedPage, setPage] = useState(1);
  const result = useMemo(() => queryLocalList(rows, {
    search, searchText: config.searchText,
    matches: row => config.filters.every(f => !filters[f.key] || f.matches(row, filters[f.key])),
    sortValue: config.sorts.find(s => s.key === sort)?.value,
    direction,
  }), [rows, config, search, filters, sort, direction]);
  const pageCount = Math.max(1, Math.ceil(result.length / 20));
  const page = Math.min(requestedPage, pageCount);
  return {
    search, filters, sort, direction, page, pageCount, total: rows.length, count: result.length,
    rows: result.slice((page - 1) * 20, page * 20), config,
    setSearch: (value: string) => { setSearch(value); setPage(1); },
    setFilter: (key: string, value: string) => { setFilters(previous => ({ ...previous, [key]: value })); setPage(1); },
    setSort: (value: string) => { setSort(value); setPage(1); },
    toggleDirection: () => { setDirection(value => value === "asc" ? "desc" : "asc"); setPage(1); },
    setPage,
    active: Boolean(search || Object.values(filters).some(Boolean)),
    reset: () => { setSearch(""); setFilters({}); setPage(1); },
  };
}

export function LocalListTools<T>({ list, placeholder, disabled = false }: {
  list: ReturnType<typeof useLocalList<T>>; placeholder: string; disabled?: boolean;
}) {
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Tìm kiếm và lọc danh sách">
      <div className="relative min-w-0 basis-56 flex-1">
        <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label={placeholder} placeholder={placeholder} value={list.search} onChange={e => list.setSearch(e.target.value)} className="pl-9 max-md:text-[16px] pointer-coarse:text-[16px]" disabled={disabled} />
      </div>
      {list.config.filters.map(filter => <Select key={filter.key} value={list.filters[filter.key] || "__all"} onValueChange={value => list.setFilter(filter.key, value === "__all" || !value ? "" : value)} disabled={disabled}>
        <SelectTrigger aria-label={`Lọc ${filter.label}`} className="w-full sm:w-auto sm:min-w-36"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="__all">{filter.label}: Tất cả</SelectItem>{filter.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>)}
      <Select value={list.sort} onValueChange={value => { if (value) list.setSort(value); }} disabled={disabled}>
        <SelectTrigger aria-label="Sắp xếp theo" className="w-full sm:w-auto sm:min-w-36"><SelectValue /></SelectTrigger>
        <SelectContent>{list.config.sorts.map(sort => <SelectItem key={sort.key} value={sort.key}>Sắp xếp: {sort.label}</SelectItem>)}</SelectContent>
      </Select>
      <Button variant="outline" size="icon" onClick={list.toggleDirection} disabled={disabled} aria-label={list.direction === "asc" ? "Đang tăng dần, đổi sang giảm dần" : "Đang giảm dần, đổi sang tăng dần"} title={list.direction === "asc" ? "Tăng dần" : "Giảm dần"}><Icon name={list.direction === "asc" ? "arrow_upward" : "arrow_downward"} size={18} /></Button>
      {list.active && <Button variant="ghost" onClick={list.reset} disabled={disabled}>Xóa lọc</Button>}
    </div>
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span role="status">{list.count} / {list.total} kết quả{list.pageCount > 1 ? ` · Trang ${list.page}/${list.pageCount}` : ""}</span>
      {list.pageCount > 1 && <div className="flex gap-1"><Button variant="ghost" size="sm" disabled={disabled || list.page <= 1} onClick={() => list.setPage(list.page - 1)}>Trước</Button><Button variant="ghost" size="sm" disabled={disabled || list.page >= list.pageCount} onClick={() => list.setPage(list.page + 1)}>Sau</Button></div>}
    </div>
  </div>;
}
