"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useDebounce } from "@/lib/utils/use-debounce";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatDate, formatNumber, formatUnitPrice } from "@/lib/format";
import { getAllSupplierReceipts, getSupplierReceiptWorkspace, SUPPLIER_RECEIPT_KINDS, SUPPLIER_RECEIPT_STATUSES,
  type SupplierReceiptQuery, type SupplierReceiptRow, type SupplierReceiptSort, type SupplierReceiptWorkspace } from "@/lib/services/supabase/supplier-receipts";
import type { DateRange } from "@/lib/types/report";
import type { ExcelColumn } from "@/lib/utils/excel-export";

const columns: Array<ExcelColumn & { key: SupplierReceiptSort }> = [
  { key: "occurredAt", label: "Ngày phát sinh", format: "date" }, { key: "kind", label: "Nghiệp vụ" },
  { key: "documentCode", label: "Chứng từ" }, { key: "orderCode", label: "Phiếu nhập gốc" },
  { key: "supplierName", label: "Nhà cung cấp" }, { key: "branchName", label: "Chi nhánh" },
  { key: "productCode", label: "Mã hàng" }, { key: "productName", label: "Hàng hóa", width: 32 },
  { key: "stockUnit", label: "ĐVT tồn" }, { key: "quantity", label: "Số lượng", format: "number", decimalPlaces: 4 },
  { key: "unitPrice", label: "Đơn giá ghi nhận", format: "currency", decimalPlaces: 6 },
  { key: "amount", label: "Giá trị", format: "currency" }, { key: "signedAmount", label: "Tăng / giảm", format: "currency" },
  { key: "documentStatus", label: "Trạng thái phiếu hiện tại" }, { key: "priceSource", label: "Nguồn giá" }, { key: "status", label: "Đối chiếu" },
];
const money = (value: number | null) => value === null ? "Chưa xác minh" : formatCurrency(value);
const DOCUMENT_STATUSES: Record<string, string> = { completed: "Hoàn tất", partial: "Nhận một phần", ordered: "Đã đặt", cancelled: "Đã hủy", draft: "Nháp" };
const statusLabel = (value: string | null) => DOCUMENT_STATUSES[value ?? ""] ?? value ?? "Chưa xác định";
function display(row: SupplierReceiptRow, column: typeof columns[number]): string {
  const value = row[column.key];
  if (column.key === "kind") return SUPPLIER_RECEIPT_KINDS[row.kind];
  if (column.key === "status") return SUPPLIER_RECEIPT_STATUSES[row.status];
  if (column.key === "priceSource") return row.priceSource === "movement" ? "Sổ kho" : row.priceSource === "return_line" ? "Dòng trả NCC" : "Chưa xác định";
  if (column.key === "documentStatus") return statusLabel(row.documentStatus);
  if (column.key === "occurredAt") return formatDate(row.occurredAt);
  if (value === null) return "Chưa xác minh";
  if (column.key === "unitPrice") return formatUnitPrice(row.unitPrice);
  if (column.format === "currency") return formatCurrency(value as number);
  if (column.format === "number") return formatNumber(value as number);
  return String(value);
}
function cell(row: SupplierReceiptRow, column: typeof columns[number]) {
  const text = display(row,column);
  const code = column.key === "orderCode" ? row.orderCode : column.key === "documentCode" ? row.documentCode : null;
  if (!code || !row.branchId || !row.orderId) return text;
  const path = column.key === "documentCode" && row.kind === "return" ? "/hang-hoa/tra-hang-nhap" : "/hang-hoa/nhap-hang";
  const params = new URLSearchParams({ search: code, branch: row.branchId });
  return <a className="font-medium text-primary underline-offset-4 hover:underline" href={`${path}?${params}`}>{text}</a>;
}
export function SupplierReceiptsPanel({ branchId, branchName, range, ready }: { branchId?: string; branchName: string; range: DateRange; ready: boolean }) {
  const { user, tenant, hasPermission } = useAuth();
  const allowed = ["reports.analytics", "reports.view_detail", "suppliers.view_purchases"].every(permission => hasPermission(permission));
  const canExport = hasPermission("reports.export_detail");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [kind, setKind] = useState<SupplierReceiptQuery["kind"]>("all");
  const [status, setStatus] = useState<SupplierReceiptQuery["status"]>("all");
  const [sort, setSort] = useState<SupplierReceiptSort>("occurredAt");
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ scope: string; data: SupplierReceiptWorkspace } | null>(null);
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const scope = JSON.stringify([user?.id, tenant?.id, allowed, canExport, branchId, range.from, range.to, ready, search, debouncedSearch, kind, status, sort, descending, page, size, revision]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const from = range.from, to = range.to;
  useEffect(() => {
    if (!allowed || !ready || !user?.id || !tenant?.id || search !== debouncedSearch) return;
    let active = true;
    getSupplierReceiptWorkspace({ branchId, from, to, search: debouncedSearch, kind, status, sortBy: sort, descending, page, size })
      .then(data => { if (active && scopeRef.current === scope) setLoaded({ scope, data }); })
      .catch(reason => { if (active && scopeRef.current === scope) setError({ scope, message: reason instanceof Error ? reason.message : "Không tải được thực nhập." }); });
    return () => { active = false; if (scopeRef.current === scope) scopeRef.current = ""; };
  }, [allowed, ready, user?.id, tenant?.id, branchId, from, to, search, debouncedSearch, kind, status, sort, descending, page, size, scope]);
  const data = loaded?.scope === scope ? loaded.data : null;
  const failure = error?.scope === scope ? error.message : null;
  const busy = !data && !failure;
  async function exportFull() {
    if (!canExport || !data || failure || exporting || scopeRef.current !== scope) return;
    setExporting(true);
    try {
      const rows = await getAllSupplierReceipts({ branchId, from, to, search: debouncedSearch, kind, status, sortBy: sort, descending });
      const { exportReportToExcel } = await import("@/lib/utils/excel-export");
      if (scopeRef.current !== scope) return;
      await exportReportToExcel({ kind: "thuc-nhap-ncc", mode: "full", range, branchName, reportTitle: "Thực nhập nhà cung cấp", shouldSave: () => scopeRef.current === scope,
        disclaimer: "Theo ngày biến động và giá lịch sử. Chưa phân bổ giảm giá, VAT, phí của phiếu; không phải tiền đã chi. ĐVT tồn và thông tin phiếu là danh mục/trạng thái hiện tại. Trống là chưa xác minh.",
        sheets: [{ name: "Thực nhập", columns, rows: rows.map(row => ({ ...row, kind: SUPPLIER_RECEIPT_KINDS[row.kind], status: SUPPLIER_RECEIPT_STATUSES[row.status],
          documentStatus: statusLabel(row.documentStatus), priceSource: row.priceSource === "movement" ? "Sổ kho" : row.priceSource === "return_line" ? "Dòng trả NCC" : null })) }] });
    } catch (reason) {
      if (scopeRef.current === scope) setError({ scope, message: reason instanceof Error ? reason.message : "Không xuất được Excel." });
    } finally { setExporting(false); }
  }
  if (!allowed) return <p role="alert" className="p-4 text-sm text-muted-foreground">Không có quyền xem thực nhập.</p>;
  return <section aria-label="Thực nhập nhà cung cấp" className="min-w-0">
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-3">
      <div className="mr-auto"><h2 className="text-base font-semibold">Thực nhập NCC</h2><p className="text-xs text-muted-foreground">Giá ghi nhận; chưa phân bổ giảm giá, VAT và phí phiếu.</p></div>
      <Button variant="outline" size="sm" aria-label="Tải lại thực nhập" title="Tải lại thực nhập" onClick={() => setRevision(value => value + 1)}><Icon name="refresh" size={16} /></Button>
      {canExport && <Button variant="outline" size="sm" onClick={exportFull} disabled={busy || !!failure || exporting}><Icon name="download" size={16} className="mr-1" />{exporting ? "Đang xuất" : "Excel đầy đủ"}</Button>}
    </div>
    <div className="grid grid-cols-2 gap-3 border-b p-3 xl:grid-cols-4">
      {[
        ["Nhập kho", data?.summary.receivedAmount, "border-emerald-500"], ["Hoàn nhập", data?.summary.revertedAmount, "border-amber-500"],
        ["Trả NCC", data?.summary.returnedAmount, "border-rose-500"], ["Giá trị ròng", data?.summary.netAmount, "border-primary"],
      ].map(([label, value, color]) => <div key={String(label)} className={`min-w-0 border-l-2 pl-3 ${color}`}><p className="text-xs text-muted-foreground">{label}</p><p className="break-words font-semibold tabular-nums">{busy ? "Đang tải" : failure ? "Không tải được" : money(value as number | null)}</p></div>)}
    </div>
    {!!data?.summary.reviewRows && <p role="status" className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{formatNumber(data.summary.reviewRows)} dòng cần đối chiếu. Giá trị thiếu nguồn chưa được chốt.</p>}
    <div className="flex flex-wrap gap-2 p-3">
      <input aria-label="Tìm thực nhập" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Mã phiếu, nhà cung cấp, hàng hóa" className="h-9 min-w-0 basis-full rounded-md border bg-background px-3 text-sm lg:flex-1 lg:basis-auto" />
      <select aria-label="Nghiệp vụ thực nhập" value={kind} onChange={event => { setKind(event.target.value as typeof kind); setPage(0); }} className="h-9 max-w-full rounded-md border bg-background px-2 text-sm"><option value="all">Mọi nghiệp vụ</option>{Object.entries(SUPPLIER_RECEIPT_KINDS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select aria-label="Đối chiếu thực nhập" value={status} onChange={event => { setStatus(event.target.value as typeof status); setPage(0); }} className="h-9 max-w-full rounded-md border bg-background px-2 text-sm"><option value="all">Mọi trạng thái nguồn</option>{Object.entries(SUPPLIER_RECEIPT_STATUSES).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select aria-label="Sắp xếp thực nhập" value={sort} onChange={event => { setSort(event.target.value as SupplierReceiptSort); setPage(0); }} className="h-9 max-w-full rounded-md border bg-background px-2 text-sm">{columns.map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</select>
      <Button variant="outline" size="sm" title="Đổi chiều sắp xếp" aria-label={descending ? "Giảm dần" : "Tăng dần"} onClick={() => { setDescending(value => !value); setPage(0); }}><Icon name={descending ? "south" : "north"} size={16} /></Button>
    </div>
    {failure ? <p role="alert" className="p-4 text-sm text-destructive">{failure}</p> : busy ? <p role="status" className="p-4 text-sm text-muted-foreground">Đang tải thực nhập…</p> : !data?.items.length ? <p className="p-4 text-sm text-muted-foreground">Không có phát sinh trong kỳ.</p> : <>
      <div role="region" aria-label="Bảng thực nhập" tabIndex={0} className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead className="bg-muted/50"><tr>{columns.map(column => <th key={column.key} className="whitespace-nowrap px-3 py-2 text-left font-medium">{column.label}</th>)}</tr></thead><tbody>{data.items.map(row => <tr key={row.id} className="border-t">{columns.map(column => <td key={column.key} className="whitespace-nowrap px-3 py-2 tabular-nums">{cell(row,column)}</td>)}</tr>)}</tbody></table></div>
      <div className="divide-y md:hidden">{data.items.map(row => <article key={row.id} className="p-3"><h3 className="font-semibold">{row.documentCode ?? "Chưa liên kết phiếu"} · {SUPPLIER_RECEIPT_KINDS[row.kind]}</h3><dl className="mt-2 grid grid-cols-2 gap-2 text-sm">{columns.filter(column => column.key !== "documentCode" && column.key !== "kind").map(column => <div key={column.key} className="min-w-0"><dt className="text-xs text-muted-foreground">{column.label}</dt><dd className="break-words tabular-nums">{cell(row,column)}</dd></div>)}</dl></article>)}</div>
    </>}
    <div className="flex flex-wrap items-center justify-end gap-2 border-t p-3 text-sm"><span>{data?.total ?? 0} dòng biến động</span><select aria-label="Số dòng thực nhập" value={size} onChange={event => { setSize(Number(event.target.value)); setPage(0); }} className="h-8 rounded border bg-background">{[20,50,100,200].map(value => <option key={value} value={value}>{value} dòng</option>)}</select><Button variant="outline" size="sm" aria-label="Trang trước thực nhập" disabled={busy || page === 0} onClick={() => setPage(value => value - 1)}><Icon name="chevron_left" size={16} /></Button><span>{page+1} / {Math.max(1, Math.ceil((data?.total ?? 0)/size))}</span><Button variant="outline" size="sm" aria-label="Trang sau thực nhập" disabled={busy || !data || (page+1)*size>=data.total} onClick={() => setPage(value => value+1)}><Icon name="chevron_right" size={16} /></Button></div>
  </section>;
}
