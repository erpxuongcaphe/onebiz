"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/lib/contexts";
import {
  getCustomerProductTransactions,
  type CustomerProductTransaction,
  type CustomerProductTransactionsFilter,
  type CustomerProductTransactionsPage,
} from "@/lib/services/supabase/analytics";
import { exportReportToExcel } from "@/lib/utils/excel-export";
import { getInvoiceItems } from "@/lib/services/supabase/invoices";

const pageSize = 50;
const dateFormat = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Bangkok" });
const excelDateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
const numberFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 });
const columns = [
  { label: "Ngày bán", key: "date", width: 14, format: "date" },
  { label: "Mã hóa đơn", key: "invoice_code", width: 16 },
  { label: "Mã đơn đặt", key: "order_code", width: 16 },
  { label: "Chi nhánh", key: "branch_name", width: 24 },
  { label: "Mã hàng", key: "product_code", width: 18 },
  { label: "Tên hàng", key: "product_name", width: 36 },
  { label: "ĐVT", key: "unit", width: 10 },
  { label: "Số lượng", key: "quantity", width: 14, format: "number", numberFormat: "#,##0.######" },
  { label: "Đơn giá (đ)", key: "unit_price", width: 16, format: "number", numberFormat: "#,##0.######" },
  { label: "Giảm dòng (đ)", key: "discount", width: 16, format: "number", numberFormat: "#,##0.######" },
  { label: "Thành tiền (đ)", key: "total", width: 18, format: "number", numberFormat: "#,##0.######" },
] as const;

export interface TransactionsSelection {
  filter: CustomerProductTransactionsFilter;
  customerName: string;
  branchName: string;
}

export function TransactionsDialog({ selection, close }: {
  selection: TransactionsSelection;
  close: () => void;
}) {
  const { toast } = useToast();
  const { filter, customerName, branchName } = selection;
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<CustomerProductTransactionsPage | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [invoice, setInvoice] = useState<CustomerProductTransaction | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<Awaited<ReturnType<typeof getInvoiceItems>> | null>(null);
  const [invoiceError, setInvoiceError] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    let cancelled = false;
    getInvoiceItems(invoice.invoice_id)
      .then(items => { if (!cancelled) setInvoiceItems(items); })
      .catch(() => { if (!cancelled) setInvoiceError(true); });
    return () => { cancelled = true; };
  }, [invoice]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError("");
    getCustomerProductTransactions(filter, page * pageSize)
      .then(data => { if (!cancelled) setResult(data); })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Không tải được chi tiết giao dịch.");
      });
    return () => { cancelled = true; };
  }, [filter, page]);

  async function exportDetails() {
    setExporting(true);
    try {
      const rows: CustomerProductTransaction[] = [];
      const first = await getCustomerProductTransactions(filter, 0, true);
      rows.push(...first.rows);
      while (rows.length < first.total) {
        const next = await getCustomerProductTransactions(filter, rows.length, true);
        if (!next.rows.length || next.total !== first.total || next.revenue !== first.revenue) {
          throw new Error("Số liệu đã thay đổi. Anh vui lòng xuất lại.");
        }
        rows.push(...next.rows);
      }
      if (rows.length !== first.total || new Set(rows.map(row => row.id)).size !== first.total) {
        throw new Error("Số liệu đã thay đổi. Anh vui lòng xuất lại.");
      }
      await exportReportToExcel({
        kind: "khach-san-pham",
        mode: "full",
        range: filter.range,
        branchName,
        reportTitle: "Chi tiết giao dịch theo khách hàng",
        description: [customerName, filter.product?.productName, filter.search].filter(Boolean).join(" · "),
        sheets: [{
          name: "Chi tiết giao dịch",
          columns: columns.map(column => ({ ...column })),
          rows: rows.map(row => ({
            ...row,
            date: new Date(excelDateFormat.format(new Date(row.sold_at)) + "T00:00:00Z"),
          })),
          footerLabel: "Tổng thành tiền",
          footer: { total: first.revenue },
        }],
      });
      toast({ title: "Đã xuất chi tiết giao dịch", variant: "success" });
    } catch (reason) {
      toast({
        title: "Không xuất được chi tiết",
        description: reason instanceof Error ? reason.message : "Vui lòng thử lại.",
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="flex max-h-[90dvh] w-[96vw] flex-col overflow-hidden sm:max-w-7xl">
        <DialogTitle>Chi tiết giao dịch</DialogTitle>
        <DialogDescription>
          {[customerName, filter.product?.productName ?? (filter.search || "Tất cả mặt hàng"), branchName,
            `${filter.range.from} – ${filter.range.to}`].filter(Boolean).join(" · ")}
        </DialogDescription>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span aria-live="polite" className="text-sm">
            {result ? `${numberFormat.format(result.total)} dòng · ${numberFormat.format(result.revenue)} đ`
              : error || "Đang tải chi tiết…"}
          </span>
          <Button variant="outline" disabled={exporting || !result?.total} onClick={exportDetails}>
            {exporting ? "Đang xuất…" : "Xuất Excel chi tiết"}
          </Button>
        </div>
        <div className="min-h-0 overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="sticky top-0 bg-surface-container">
              <tr>{columns.map((column, index) => (
                <th key={column.key} scope="col" className={`whitespace-nowrap px-3 py-2 ${index >= 7 ? "text-right" : "text-left"}`}>
                  {column.label}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {result?.rows.map(row => (
                <tr key={row.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-3 py-2">{dateFormat.format(new Date(row.sold_at))}</td>
                  <td className="px-3 py-2">
                    <button type="button" className="text-primary hover:underline" onClick={() => {
                      setInvoiceItems(null);
                      setInvoiceError(false);
                      setInvoice(row);
                    }}>{row.invoice_code}</button>
                  </td>
                  <td className="px-3 py-2">{row.order_code ?? "—"}</td>
                  <td className="px-3 py-2">{row.branch_name ?? "—"}</td>
                  <td className="px-3 py-2">{row.product_code}</td>
                  <td className="px-3 py-2">{row.product_name}</td>
                  <td className="px-3 py-2">{row.unit}</td>
                  {[row.quantity, row.unit_price, row.discount, row.total].map((value, index) => (
                    <td key={index} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{numberFormat.format(value)}</td>
                  ))}
                </tr>
              ))}
              {result?.total === 0 && <tr><td colSpan={columns.length} className="p-5 text-center">Không có giao dịch phù hợp.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-3 text-sm">
          <Button size="sm" variant="outline" disabled={!result || page === 0} onClick={() => { setResult(null); setPage(page - 1); }}>Trang trước</Button>
          <span>Trang {page + 1}{result ? ` / ${Math.max(1, Math.ceil(result.total / pageSize))}` : ""}</span>
          <Button size="sm" variant="outline" disabled={!result || (page + 1) * pageSize >= result.total} onClick={() => { setResult(null); setPage(page + 1); }}>Trang sau</Button>
        </div>
        <Dialog open={invoice !== null} onOpenChange={open => { if (!open) setInvoice(null); }}>
          <DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-3xl">
            <DialogTitle>Hóa đơn {invoice?.invoice_code}</DialogTitle>
            <DialogDescription>
              {invoice && [customerName, dateFormat.format(new Date(invoice.sold_at)), invoice.branch_name].filter(Boolean).join(" · ")}
            </DialogDescription>
            {invoiceError || invoiceItems?.length === 0
              ? <p>Không tải được dòng hàng của hóa đơn.</p>
              : !invoiceItems ? <p>Đang tải hóa đơn…</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left">
                    {["Mặt hàng", "Số lượng", "Đơn giá", "Thành tiền"].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}
                  </tr></thead>
                  <tbody>{invoiceItems.map(item => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="p-2">{item.productName}</td>
                      <td className="p-2">{numberFormat.format(item.quantity)} {item.unit}</td>
                      <td className="p-2">{numberFormat.format(item.unitPrice)}</td>
                      <td className="p-2">{numberFormat.format(item.total)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
