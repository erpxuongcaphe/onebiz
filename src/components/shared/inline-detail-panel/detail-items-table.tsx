"use client";

import { ReactNode, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { resolveTableColumnAlignment, tableColumnAlignmentClass } from "@/lib/table-column-alignment";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { normalizeSearch, oneEditApart } from "@/lib/smart-search";
import { Input } from "@/components/ui/input";
import { usePermissions } from "@/lib/permissions/use-permission";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { exportToExcel } from "@/lib/utils/export";

export interface ItemColumn<T> {
  header: string;
  accessor: keyof T | ((item: T) => ReactNode);
  align?: "left" | "center" | "right";
  className?: string;
  /**
   * Responsive Sprint B3 (CEO 25/05/2026): cho phép ẩn cột ở viewport nhỏ.
   * - "mobile": ẩn dưới 640px (< sm:), hiện sm+
   * - "tablet": ẩn dưới 1024px (< lg:), hiện lg+
   * - "laptop13": ẩn dưới 1280px (< xl:), hiện xl+ (cho cột phụ chỉ
   *   nên hiện trên laptop 15.6"+ hoặc desktop)
   */
  hideOn?: "mobile" | "tablet" | "laptop13";
}

function hideClassFor(hideOn?: ItemColumn<unknown>["hideOn"]): string {
  if (hideOn === "mobile") return "hidden sm:table-cell";
  if (hideOn === "tablet") return "hidden lg:table-cell";
  if (hideOn === "laptop13") return "hidden xl:table-cell";
  return "";
}

interface DetailItemsTableProps<T> {
  columns: ItemColumn<T>[];
  items: T[];
  /** Summary rows shown below items (e.g. "Tổng tiền hàng", "Giảm giá") */
  summary?: { label: string; value: ReactNode; className?: string }[];
  className?: string;
  pageSize?: number;
  mobileItem?: (item:T)=>ReactNode;
  optionalColumns?: string[];
  searchFields?: (item: T) => readonly string[];
}

export function DetailItemsTable<T>({
  columns,
  items,
  summary,
  className,
  pageSize,
  mobileItem,
  optionalColumns,
  searchFields,
}: DetailItemsTableProps<T>) {
  const [page, setPage] = useState(0);
  const [hiddenColumns,setHiddenColumns]=useState<string[]>([]);
  const effectiveColumns=columns.filter(c=>!hiddenColumns.includes(c.header));
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("date:desc");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const invalidDates = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const query = normalizeSearch(search);
  const scoped = useMemo(() => {
    if (!pageSize) return items;
    const [key, direction] = sort.split(":");
    const value = (item: T) => {
      const row = item as Record<string, unknown>;
      if (key === "amount") return Number(row.totalAmount ?? row.total ?? 0);
      if (key === "debt") return Number(row.debt ?? row.amountOwed ?? 0);
      return String(row[key] ?? "");
    };
    return items.filter(item => {
      const row = item as Record<string, unknown>;
      const rawDate = String(row.date ?? "");
      const day = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : Number.isNaN(Date.parse(rawDate)) ? "" : new Date(rawDate).toLocaleDateString("en-CA", {timeZone:"Asia/Ho_Chi_Minh"});
      return (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo) && (!status || row.status === status);
    }).sort((a, b) => {
      const av = value(a), bv = value(b);
      const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "vi", { numeric: true });
      const tie = String((a as Record<string, unknown>).id ?? "").localeCompare(String((b as Record<string, unknown>).id ?? ""));
      return (result || tie) * (direction === "asc" ? 1 : -1);
    });
  }, [items, sort, pageSize, dateFrom, dateTo, status]);
  const { rows: filtered, approximate } = useMemo(() => {
    if (!query) return { rows: scoped, approximate: false };
    // Keep a typed identifier together so its parts cannot match unrelated fields.
    const terms = search.trim().split(/\s+/).map(normalizeSearch).filter(Boolean);
    const exact: T[] = [];
    const near: T[] = [];
    for (const item of scoped) {
      const row = item as Record<string, unknown>;
      const name = normalizeSearch(String(row.productName ?? row.name ?? ""));
      const fields = [
        row.productCode, row.code, row.invoiceCode, row.productName, row.name,
        row.unit, row.note, row.variantLabel, row.quantity, row.unitPrice, row.total,
        ...columns.map(({ accessor }) => typeof accessor === "function" ? accessor(item) : item[accessor]),
        ...(pageSize ? Object.values(row) : []),
        ...(searchFields?.(item) ?? []),
      ].flatMap(value => {
        if (typeof value !== "string" && typeof value !== "number") return [];
        const normalized = normalizeSearch(String(value));
        return typeof value === "string" && /^[a-z][a-z0-9-]*\d[a-z0-9-]*$/i.test(value)
          ? [normalized, normalized.replace(/ /g, "")]
          : [normalized];
      });
      const missing = terms.filter(term => !fields.some(field => field.includes(term)));
      if (!missing.length) exact.push(item);
      else if (missing.length === 1 && /^[a-z]{4,}$/i.test(missing[0]) &&
        name.split(" ").some(word => word.length >= 4 && oneEditApart(word, missing[0]))) {
        near.push(item);
      }
    }
    return exact.length ? { rows: exact, approximate: false } : { rows: near, approximate: near.length > 0 };
  }, [scoped, query, search, columns, pageSize, searchFields]);
  const currentPage = pageSize ? Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1)) : 0;
  const visible = pageSize ? filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : filtered;
  const download = async () => {
    if (invalidDates || exporting) return;
    setExporting(true); setExportError("");
    try {
      await exportToExcel(filtered.map(item => {
        const row = item as Record<string, unknown>;
        return { code: row.code, date: row.date, original: row.invoiceCode,
          total: row.totalAmount ?? row.total, paid: row.paid, debt: row.debt ?? row.amountOwed,
          status: row.status === "cancelled" ? "Đã hủy" : row.status === "completed" ? "Hoàn thành" : row.status === "partial" ? "Một phần" : "Chưa hoàn tất" };
      }), [{header:"Mã chứng từ",key:"code"},{header:"Ngày chứng từ",key:"date"},{header:"Chứng từ gốc",key:"original"},
        {header:"Tổng tiền",key:"total"},{header:"Đã thanh toán",key:"paid"},{header:"Còn nợ",key:"debt"},{header:"Trạng thái",key:"status"}], "OneBiz_LichSuChungTu");
    } catch (err) { setExportError(err instanceof Error ? err.message : "Không xuất được lịch sử."); }
    finally { setExporting(false); }
  };
  const columnAlignments = useMemo(() => effectiveColumns.map(col => resolveTableColumnAlignment(
    col.align,
    typeof col.accessor === "function" ? "" : String(col.accessor),
    col.align ? [] : items.map(item => typeof col.accessor === "function" ? col.accessor(item) : item[col.accessor]),
  )), [effectiveColumns, items]);

  const searchInput = (
    <div className="relative w-full sm:w-80">
      <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input type="search"
        aria-label={pageSize ? "Tìm trong toàn bộ lịch sử chứng từ" : "Tìm trong danh sách chi tiết"}
        placeholder={pageSize ? "Mã chứng từ, ngày, trạng thái..." : "Tên, mã hàng, đơn vị, ghi chú..."}
        value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
    </div>
  );
  const emptyMessage = query ? "Không tìm thấy dòng phù hợp" : "Không có dữ liệu";
  return (
    <div className={cn("min-w-0 border rounded-lg overflow-hidden", className)}>
      {!pageSize && items.length > 0 && <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        {searchInput}
        {query && <span role="status" className="text-xs text-muted-foreground">
          {filtered.length}/{items.length} dòng{approximate ? " · Kết quả gần đúng" : ""}
        </span>}
      </div>}
      {pageSize && <div className="flex flex-wrap gap-2 p-3 border-b">
        {searchInput}
        <label className="text-xs">Từ ngày<Input type="date" value={dateFrom} onChange={e => {setDateFrom(e.target.value);setPage(0);}} /></label>
        <label className="text-xs">Đến ngày<Input type="date" value={dateTo} onChange={e => {setDateTo(e.target.value);setPage(0);}} /></label>
        <select aria-label="Trạng thái chứng từ lịch sử" className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={e => {setStatus(e.target.value);setPage(0);}}><option value="">Tất cả trạng thái</option>{[...new Set(items.map(item => String((item as Record<string, unknown>).status ?? "")))].filter(Boolean).sort().map(s => <option key={s} value={s}>{s === "cancelled" ? "Đã hủy" : s === "completed" ? "Hoàn thành" : s === "partial" ? "Một phần" : s === "draft" ? "Nháp" : s === "ordered" ? "Đã đặt" : s === "confirmed" ? "Đã xác nhận" : s}</option>)}</select>
        <select aria-label="Sắp xếp lịch sử chứng từ" value={sort} onChange={e => {setSort(e.target.value); setPage(0);}} className="h-9 rounded-md border bg-background px-2 text-sm">
          <option value="date:desc">Ngày mới nhất</option><option value="date:asc">Ngày cũ nhất</option>
          <option value="code:asc">Mã A–Z</option><option value="code:desc">Mã Z–A</option>
          <option value="amount:desc">Tổng tiền giảm dần</option><option value="amount:asc">Tổng tiền tăng dần</option>
          <option value="debt:desc">Còn nợ giảm dần</option><option value="debt:asc">Còn nợ tăng dần</option>
        </select>
        <HistoryExportButton disabled={exporting || invalidDates || !filtered.length} exporting={exporting} onClick={download} />
        {invalidDates && <p role="alert" className="w-full text-sm text-destructive">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>}
        {exportError && <p role="alert" className="w-full text-sm text-destructive">{exportError}</p>}
      </div>}
      {optionalColumns&&<details className="hidden border-b px-3 py-2 text-xs md:block"><summary className="w-fit cursor-pointer">Cột chi tiết món</summary><div className="flex flex-wrap gap-3 pt-2">{optionalColumns.map(header=><label key={header} className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={!hiddenColumns.includes(header)} onChange={e=>setHiddenColumns(v=>e.target.checked?v.filter(x=>x!==header):[...v,header])}/>{header}</label>)}</div></details>}
      <div className="divide-y md:hidden">
        {visible.map((item, index) => (
          <div key={index} className="min-w-0 space-y-2 p-3">
            {mobileItem ? mobileItem(item) : effectiveColumns.map((column, columnIndex) => {
              const value = typeof column.accessor === "function" ? column.accessor(item) : item[column.accessor] as ReactNode;
              const record = item as Record<string, unknown>;
              const href = pageSize && columnIndex === 0 && record.id
                ? `${"supplierReturn" in record ? "/hang-hoa/tra-hang-nhap" : "amountOwed" in record ? "/hang-hoa/nhap-hang" : "invoiceCode" in record ? "/don-hang/tra-hang" : "/don-hang/hoa-don"}?focus=${encodeURIComponent(String(record.id))}` : null;
              return <div key={columnIndex} className="flex min-w-0 items-start justify-between gap-3 text-sm">
                <span className="shrink-0 text-xs text-muted-foreground">{column.header}</span>
                <span className="min-w-0 break-words text-right font-medium [&_*]:max-w-full">{href ? <a className="text-primary underline" href={href} target="_blank" rel="noopener noreferrer">{value}</a> : value}</span>
              </div>;
            })}
          </div>
        ))}
        {visible.length === 0 && <p className="p-4 text-center text-muted-foreground">{emptyMessage}</p>}
      </div>
      <div data-slot="detail-items-scroll" className="hidden max-h-[480px] overflow-auto md:block">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr className="bg-muted/50">
            {effectiveColumns.map((col, idx) => (
              <th
                key={idx}
                className={cn(
                  "px-3 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap",
                  tableColumnAlignmentClass(columnAlignments[idx]),
                  hideClassFor(col.hideOn),
                  col.className,
                  pageSize && idx === 0 && "sticky left-0 z-20 bg-muted"
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((item, rowIdx) => (
            <tr key={rowIdx} className="border-t">
              {effectiveColumns.map((col, colIdx) => {
                const value =
                  typeof col.accessor === "function"
                    ? col.accessor(item)
                    : (item[col.accessor] as ReactNode);
                return (
                  <td
                    key={colIdx}
                    className={cn(
                      "px-3 py-2",
                      tableColumnAlignmentClass(columnAlignments[colIdx]),
                      hideClassFor(col.hideOn),
                      col.className,
                      pageSize && colIdx === 0 && "sticky left-0 bg-background"
                    )}
                  >
                    {pageSize && colIdx === 0 && (item as Record<string, unknown>).id ? <a className="text-primary hover:underline" href={`${"supplierReturn" in (item as Record<string, unknown>) ? "/hang-hoa/tra-hang-nhap" : "amountOwed" in (item as Record<string, unknown>) ? "/hang-hoa/nhap-hang" : "invoiceCode" in (item as Record<string, unknown>) ? "/don-hang/tra-hang" : "/don-hang/hoa-don"}?focus=${encodeURIComponent(String((item as Record<string, unknown>).id))}`} target="_blank" rel="noopener noreferrer">{value}</a> : value}
                  </td>
                );
              })}
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td
                colSpan={effectiveColumns.length}
                className="px-3 py-6 text-center text-muted-foreground"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      {pageSize && <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm">
        <span>{filtered.length}/{items.length} chứng từ · Trang {currentPage + 1}/{Math.max(1, Math.ceil(filtered.length / pageSize))}</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trước</Button><Button size="sm" variant="outline" disabled={(currentPage + 1) * pageSize >= filtered.length} onClick={() => setPage(currentPage + 1)}>Sau</Button></div>
      </div>}

      {/* Summary section */}
      {summary && summary.length > 0 && (!pageSize || (!query && !dateFrom && !dateTo && !status)) && (
        <div className="border-t bg-muted/20 px-3 py-2 space-y-1">
          {summary.map((row, idx) => (
            <div
              key={idx}
              className={cn(
                "flex items-center justify-end gap-4 text-sm",
                row.className
              )}
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-semibold min-w-[120px] text-right">
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryExportButton({disabled,exporting,onClick}: {disabled:boolean;exporting:boolean;onClick:()=>void}) {
  const {hasPermission} = usePermissions();
  if (!hasPermission(PERMISSIONS.REPORTS_EXPORT)) return null;
  return <Button size="sm" variant="outline" disabled={disabled} onClick={onClick}>{exporting ? "Đang xuất..." : "Xuất Excel"}</Button>;
}
