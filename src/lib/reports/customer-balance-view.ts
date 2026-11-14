import type { CustomerReportBalances, CustomerReportBalanceRow } from "@/lib/services/supabase/customer-report-balances";
import type { ExcelSheet } from "@/lib/utils/excel-export";
import { normalizeListSearch } from "@/lib/local-list-query";

export type CustomerBalanceSort = "name" | "code" | "receivable" | "advance";

export function customerBalanceRows(source: CustomerReportBalances | null, search: string,
  sort: CustomerBalanceSort, direction: "asc" | "desc"): CustomerReportBalanceRow[] {
  if (!source?.canViewDebt) return [];
  const needle = normalizeListSearch(search);
  return source.rows.filter(row => normalizeListSearch(`${row.code} ${row.name}`).includes(needle))
    .sort((a, b) => {
      const delta = sort === "name" || sort === "code"
        ? a[sort].localeCompare(b[sort], "vi", { numeric: true }) : a[sort] - b[sort];
      return delta * (direction === "asc" ? 1 : -1) || a.customerId.localeCompare(b.customerId);
    });
}

export function customerBalanceSheet(source: CustomerReportBalances, search: string,
  sort: CustomerBalanceSort, direction: "asc" | "desc"): ExcelSheet | null {
  if (!source.canViewDebt) return null;
  const rows = customerBalanceRows(source, search, sort, direction);
  return {
    name: "Số dư khách hàng",
    titleRows: [
      "SỐ DƯ KHÁCH HÀNG HIỆN TẠI",
      `Thời điểm: ${new Date(source.asOf).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`,
      "Nợ phải thu và tiền ứng theo dõi riêng; không phải phát sinh trong kỳ.",
      source.complete ? "Dữ liệu đầy đủ trong phạm vi báo cáo" : "Chưa đầy đủ: có số dư thiếu chi nhánh hoặc chưa xác định khách hàng",
    ],
    columns: [
      { label: "Mã khách", key: "code", width: 20 },
      { label: "Khách hàng", key: "name", width: 34 },
      { label: "Nợ phải thu", key: "receivable", width: 22, format: "currency" },
      { label: "Tiền ứng còn lại", key: "advance", width: 22, format: "currency" },
    ],
    rows: rows.map(row => ({ ...row })),
    footer: { name: `Tổng ${rows.length} khách`,
      receivable: rows.reduce((sum, row) => sum + row.receivable, 0),
      advance: rows.reduce((sum, row) => sum + row.advance, 0) },
  };
}
