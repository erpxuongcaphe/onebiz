"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import {
  previewInvoiceBulkCancel, executeInvoiceBulkCancel, canCancelInvoice,
  type InvoiceCancelPreview, type InvoiceCancelResult, type InvoiceCancelPermissions,
} from "@/lib/services/supabase/invoice-bulk-cancel";

export function BulkInvoiceCancelDialog({ ids, permissions, onClose, onDone }: {
  ids: string[]; permissions: InvoiceCancelPermissions; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [rows, setRows] = useState<InvoiceCancelPreview[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [reason, setReason] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false), [results, setResults] = useState<InvoiceCancelResult[]>([]);
  const locked = useRef(false);
  useEffect(() => {
    let disposed = false;
    previewInvoiceBulkCancel(ids).then(data => { if (!disposed) setRows(data); })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : "Không tải được tác động."); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [ids]);
  const eligible = rows.filter(row => canCancelInvoice(row, permissions) && ["completed", "draft", "confirmed"].includes(row.status));
  const completed = eligible.filter(row => row.status === "completed");
  const done = results.length > 0 && !running;
  const execute = async () => {
    if (locked.current || loading || error || !acknowledged || reason.trim().length < 3 || !eligible.length) return;
    locked.current = true; setRunning(true); setError("");
    try {
      await executeInvoiceBulkCancel(rows, reason, permissions, result => setResults(old => [...old, result]));
    } catch (err) { setError(err instanceof Error ? err.message : "Không thực hiện được."); }
    finally {
      try { await onDone(); } catch { setError(old => old || "Chưa làm mới được danh sách. Tải lại để đối chiếu kết quả."); }
      setRunning(false);
      // No automatic retry after timeout or partial success.
    }
  };
  return <Dialog open onOpenChange={open => { if (!open && !running) onClose(); }}>
    <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>Hủy & hoàn tác hàng loạt · {ids.length} hóa đơn</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Giữ chứng từ và lịch sử. Hóa đơn đã thanh toán được hoàn tác theo giao dịch gốc, không tính lại BOM hiện tại.</p>
      {loading ? <p role="status">Đang kiểm tra tiền và xuất kho gốc…</p> : <>
        <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-sm">
          <div>Đủ điều kiện<strong className="block">{eligible.length} / {rows.length}</strong></div>
          <div>Tiền ghi hoàn<strong className="block tabular-nums">{formatCurrency(completed.reduce((s, row) => s + row.refund, 0))}</strong></div>
          <div>Dòng xuất kho hoàn<strong className="block tabular-nums">{completed.reduce((s, row) => s + row.stockMovements, 0)}</strong></div>
        </div>
        <div className="max-h-60 overflow-auto rounded-lg border">
          <table className="w-full text-sm"><thead className="sticky top-0 bg-muted"><tr>
            <th className="p-2 text-left">Hóa đơn</th><th className="p-2 text-right">Tiền ghi hoàn</th><th className="p-2 text-left">Kết quả / điều kiện</th>
          </tr></thead><tbody>{rows.map(row => {
            const result = results.find(item => item.id === row.id);
            return <tr className="border-t" key={row.id}><td className="p-2 whitespace-nowrap">{row.code}</td>
              <td className="p-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(row.status === "completed" ? row.refund : 0)}</td>
              <td className="p-2">{result ? result.message : !canCancelInvoice(row, permissions) ? "Không có quyền — bỏ qua" : row.status === "cancelled" ? "Đã hủy — bỏ qua" : row.status === "completed" ? "Đã thanh toán · hoàn tác" : "Chưa hoàn thành"}</td></tr>;
          })}</tbody></table>
        </div>
        <p className="text-xs text-muted-foreground">Giữ phương thức thu gốc khi ghi hoàn. Không tự chuyển tiền ngân hàng; nếu cần trả khách, thực hiện và đối chiếu riêng. Kho được hoàn theo lượng đã xuất; món đã làm nhưng không thu hồi cần ghi nhận xuất hủy riêng.</p>
        {!done && <><Input aria-label="Lý do hủy hàng loạt" placeholder="Lý do hủy * (ít nhất 3 ký tự)" value={reason} onChange={e => setReason(e.target.value)} disabled={running} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} disabled={running} />Tôi đã kiểm tra đúng các hóa đơn và tác động tiền, kho ở trên.</label></>}
      </>}
      {running && <p role="status" className="text-sm">Đang xử lý {results.length} / {rows.length}. Giữ cửa sổ này mở.</p>}
      {done && <p role="status" className="text-sm">Đã hủy {results.filter(row => row.ok).length} / {rows.length}. Các dòng chưa thành công giữ kết quả ở trên; kiểm tra lại trước khi thử lại.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={running} onClick={onClose}>Đóng</Button>
        {!done && <Button variant="destructive" disabled={loading || running || !!error || !eligible.length || !acknowledged || reason.trim().length < 3 || locked.current} onClick={execute}>Xác nhận hủy {eligible.length} hóa đơn</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
