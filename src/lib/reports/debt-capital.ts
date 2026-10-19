import type { DebtPartyRow } from "@/lib/services/supabase/debt-workspace";
import { matchesMetricFilters, type MetricFilter } from "./metric-filter";
import { sortReportRows } from "./table-sort";

export const DEBT_FIELDS = [
  { key: "code", label: "Mã đối tác" },
  { key: "name", label: "Đối tác" },
  { key: "phone", label: "Điện thoại" },
  { key: "documentCount", label: "Chứng từ còn nợ" },
  { key: "debt", label: "Nợ chứng từ" },
  { key: "advance", label: "Tiền ứng còn dư" },
  { key: "availableOffset", label: "Có thể đối chiếu cấn" },
  { key: "netBalance", label: "Số dư ròng" },
  { key: "bucket0_30", label: "0–30 ngày" },
  { key: "bucket31_60", label: "31–60 ngày" },
  { key: "bucket61_90", label: "61–90 ngày" },
  { key: "bucket91Plus", label: "Trên 90 ngày" },
  { key: "agedDebt", label: "Nợ đã phân tuổi" },
  { key: "agingDifference", label: "Chênh lệch phân tuổi" },
  { key: "ageDays", label: "Tuổi lớn nhất (ngày)" },
  { key: "oldestDocumentDate", label: "Ngày chứng từ cũ nhất" },
] as const;
export const DEBT_GROUPS = [
  { label: "Đối tác", span: 3 }, { label: "Nợ và tiền ứng", span: 5 },
  { label: "Tuổi chứng từ", span: 4 }, { label: "Kiểm soát", span: 4 },
];
const TEXT_FIELDS = new Set(["code", "name", "phone", "oldestDocumentDate"]);
export const DEBT_METRIC_FIELDS = DEBT_FIELDS.filter(field => !TEXT_FIELDS.has(field.key));
export const DEBT_REVIEW_LABELS = {
  all: "Tất cả đối tác", debt: "Còn nợ chứng từ", advance: "Còn tiền ứng",
  both: "Có nợ và tiền ứng", older30: "Nợ trên 30 ngày", older90: "Nợ trên 90 ngày", gap: "Lệch phân tuổi",
};
export type DebtReview = keyof typeof DEBT_REVIEW_LABELS;
export function debtCapitalRows(rows: DebtPartyRow[]) {
  return rows.map(row => {
    const buckets = {
      bucket0_30: row.ageBuckets?.bucket0_30 ?? null,
      bucket31_60: row.ageBuckets?.bucket31_60 ?? null,
      bucket61_90: row.ageBuckets?.bucket61_90 ?? null,
      bucket91Plus: row.ageBuckets?.bucket91Plus ?? null,
    };
    const values = Object.values(buckets);
    const agedDebt = values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return { ...row, ...buckets, agedDebt,
      agingDifference: agedDebt === null ? null : row.debt - agedDebt,
      availableOffset: Math.min(Math.max(row.debt, 0), Math.max(row.advance, 0)),
    };
  });
}
export type DebtCapitalRow = ReturnType<typeof debtCapitalRows>[number];
export function debtCapitalView(rows: DebtCapitalRow[], filters: { search: string; review: DebtReview; metrics: MetricFilter[] }, sort: { id: string; direction: "asc" | "desc" } | null) {
  const search = filters.search.trim().toLocaleLowerCase("vi");
  const result = rows.filter(row => {
    if (search && ![row.code, row.name, row.phone ?? ""].some(value => value.toLocaleLowerCase("vi").includes(search))) return false;
    const review = filters.review;
    const matches = review === "all" || (review === "debt" && row.debt > 0) || (review === "advance" && row.advance > 0) ||
      (review === "both" && row.availableOffset > 0) || (review === "older30" && (row.bucket31_60 ?? 0) + (row.bucket61_90 ?? 0) + (row.bucket91Plus ?? 0) > 0) ||
      (review === "older90" && (row.bucket91Plus ?? 0) > 0) || (review === "gap" && (row.agingDifference === null || Math.abs(row.agingDifference) >= 0.01));
    return matches && matchesMetricFilters(row, filters.metrics);
  });
  return sort ? sortReportRows(result, row => row[sort.id as keyof DebtCapitalRow], sort.direction) : result;
}
export function debtCapitalTotals(rows: DebtCapitalRow[]) {
  const sum = (key: "debt" | "advance" | "availableOffset" | "netBalance" | "documentCount") => rows.reduce((total, row) => total + row[key], 0);
  const nullableSum = (key: "bucket0_30" | "bucket31_60" | "bucket61_90" | "bucket91Plus" | "agedDebt" | "agingDifference") => rows.some(row => row[key] === null) ? null : rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  return { debt: sum("debt"), advance: sum("advance"), availableOffset: sum("availableOffset"), netBalance: sum("netBalance"), documentCount: sum("documentCount"),
    bucket0_30: nullableSum("bucket0_30"), bucket31_60: nullableSum("bucket31_60"), bucket61_90: nullableSum("bucket61_90"), bucket91Plus: nullableSum("bucket91Plus"), agedDebt: nullableSum("agedDebt"), agingDifference: nullableSum("agingDifference") };
}
