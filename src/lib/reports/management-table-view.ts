import type { CashBookEntry } from "@/lib/types";
import type { TopCustomer, TopDebtor } from "@/lib/services/supabase/analytics";
import type { COGSItem } from "@/lib/services/supabase/reports";
import { cashCategoryLabel, cashPaymentMethodLabel } from "@/lib/utils/cash-book-labels";

export type SortDirection = "asc" | "desc";
export type CustomerSort = "name" | "code" | "groupName" | "orders" | "revenue" | "average";
export function customerReportRows(rows: TopCustomer[], search: string, sort: CustomerSort, direction: SortDirection, group = ""): TopCustomer[] {
  const needle = search.trim().toLocaleLowerCase("vi");
  return rows.filter(row => `${row.name} ${row.code ?? ""}`.toLocaleLowerCase("vi").includes(needle) && (!group || (row.groupName ?? "Chưa phân nhóm") === group)).sort((a, b) => {
    const difference = sort === "name" || sort === "code" || sort === "groupName" ? (a[sort] ?? "").localeCompare(b[sort] ?? "", "vi", { numeric: true })
      : sort === "average" ? (a.orders ? a.revenue / a.orders : 0) - (b.orders ? b.revenue / b.orders : 0)
      : a[sort] - b[sort];
    return difference * (direction === "asc" ? 1 : -1) || a.customerId.localeCompare(b.customerId);
  });
}

export type CashSort = "date" | "code" | "type" | "occurredAt" | "amount" | "counterparty" | "branchName" | "category" | "paymentMethod" | "createdByName" | "performedByName" | "referenceCode";
export interface CashTableFilter {
  search: string;
  type: "all" | "receipt" | "payment";
  category: string;
  method: string;
  min: string;
  max: string;
  sort: CashSort;
  direction: SortDirection;
}
export function cashReportRows(rows: CashBookEntry[], filters: CashTableFilter): CashBookEntry[] {
  const needle = filters.search.trim().toLocaleLowerCase("vi");
  const min = filters.min.trim() ? Number(filters.min) : null;
  const max = filters.max.trim() ? Number(filters.max) : null;
  if ((min !== null && (!Number.isFinite(min) || min < 0)) || (max !== null && (!Number.isFinite(max) || max < 0)) || (min !== null && max !== null && min > max)) return [];
  return rows.filter(row => (filters.type === "all" || row.type === filters.type)
    && (!filters.category || row.category === filters.category)
    && (!filters.method || row.paymentMethod === filters.method)
    && (min === null || row.amount >= min) && (max === null || row.amount <= max)
    && [row.code, row.counterparty, row.note, row.branchName, row.createdByName, row.performedByName, row.referenceCode].some(value => (value ?? "").toLocaleLowerCase("vi").includes(needle)))
    .sort((a, b) => {
      if (filters.sort === "occurredAt" && Boolean(a.occurredAt) !== Boolean(b.occurredAt)) return a.occurredAt ? -1 : 1;
      const label = (row: CashBookEntry) => filters.sort === "category" ? cashCategoryLabel(row.category)
        : filters.sort === "paymentMethod" ? cashPaymentMethodLabel(row.paymentMethod) : filters.sort === "type" ? (row.type === "receipt" ? "Thu" : "Chi") : String(row[filters.sort] ?? "");
      const difference = filters.sort === "amount" ? a.amount - b.amount
        : filters.sort === "occurredAt" ? (a.occurredAt ? Date.parse(a.occurredAt) : 0) - (b.occurredAt ? Date.parse(b.occurredAt) : 0)
        : label(a).localeCompare(label(b), "vi", { numeric: true });
      return difference * (filters.direction === "asc" ? 1 : -1) || a.id.localeCompare(b.id);
    });
}

export type CogsSort = "productName" | "qtySold" | "costPrice" | "totalCost" | "pctOfCogs" | "missingCostLines";
export function debtorReportRows(rows: TopDebtor[], search: string, sort: "name" | "debt", direction: SortDirection): TopDebtor[] {
  return rows.filter(row => row.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"))).sort((a, b) => {
    const difference = sort === "name" ? a.name.localeCompare(b.name, "vi") : a.debt - b.debt;
    return difference * (direction === "asc" ? 1 : -1) || a.name.localeCompare(b.name, "vi");
  });
}
export function cogsReportRows(rows: COGSItem[], search: string, completeness: "all" | "complete" | "missing", sort: CogsSort, direction: SortDirection): COGSItem[] {
  const needle = search.trim().toLocaleLowerCase("vi");
  return rows.filter(row => row.productName.toLocaleLowerCase("vi").includes(needle)
    && (completeness === "all" || row.costComplete === (completeness === "complete"))).sort((a, b) => {
    if (["costPrice", "totalCost", "pctOfCogs"].includes(sort) && a.costComplete !== b.costComplete) return a.costComplete ? -1 : 1;
    const difference = sort === "productName" ? a.productName.localeCompare(b.productName, "vi") : a[sort] - b[sort];
    return difference * (direction === "asc" ? 1 : -1) || a.productName.localeCompare(b.productName, "vi");
  });
}
