"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/contexts";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { getPartyAdvanceLedger, type PartyAdvanceLedgerRow } from "@/lib/services/supabase/cash-book";
import { advanceRefundPendingKey } from "@/lib/services/supabase/advance-refunds";
import { RefundAdvanceDialog } from "./refund-advance-dialog";

/** Receipt workflow: choose the exact unused supplier advance before posting. */
export function SupplierAdvanceRefundDialog({ partyId, partyName, branchId, onClose, onChanged, onHistory }: {
  partyId: string; partyName: string; branchId?: string | null;
  onClose: () => void; onChanged: () => void; onHistory: () => void;
}) {
  const { tenant, user } = useAuth();
  const [rows, setRows] = useState<PartyAdvanceLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [revision, setRevision] = useState(0);
  const [source, setSource] = useState<PartyAdvanceLedgerRow | null>(null);
  useEffect(() => {
    let active = true;
    setRows([]); setLoading(true); setError("");
    getPartyAdvanceLedger("supplier", partyId, branchId)
      .then(result => { if (active) setRows(result); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Không tải được nguồn ứng. Chưa lập phiếu thu."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [partyId, branchId, revision]);
  const pending = (id: string) => {
    if (!tenant || !user) return false;
    try { return !!localStorage.getItem(advanceRefundPendingKey(tenant.id, user.id, "supplier", id)); }
    catch { return true; }
  };
  const remaining = rows.filter(row => row.status === "active").reduce((sum, row) => sum + Number(row.remainingAmount), 0);
  const sources = rows.filter(row => (row.status === "active" && row.remainingAmount > 0) || pending(row.id));
  return (
    <Dialog open protectUnsavedChanges={false} onOpenChange={open => { if (!open && !source) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nhận nhà cung cấp hoàn ứng — {partyName}</DialogTitle>
          <DialogDescription>Chọn khoản ứng cần hoàn, sau đó chọn nơi nhận tiền và kiểm tra phiếu thu.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 border-y py-3 text-sm">
          <p><strong>Tiền từ:</strong> {partyName} → <strong>Tiền vào:</strong> quỹ / tài khoản công ty chọn ở bước tiếp theo.</p>
          <p>Chỉ hoàn phần ứng chưa sử dụng. Tiền đã cấn cho đơn mua được giữ nguyên.</p>
          {!loading && !error && <p>Tiền ứng còn có thể nhận hoàn: <strong className="tabular-nums">{formatCurrency(remaining)} đ</strong></p>}
          <p className="text-muted-foreground">Mỗi phiếu thu gắn một khoản ứng gốc. Khi hoàn nhiều khoản, lập lần lượt theo từng nguồn để giữ đủ đối chiếu.</p>
        </div>
        {success && <p role="status" className="text-sm text-status-success">{success}</p>}
        {loading ? <p role="status">Đang đối chiếu các khoản ứng...</p> : error ? <p role="alert" className="text-destructive">{error}</p> : !sources.length ? <p>Không còn khoản ứng khả dụng trong phạm vi này. Có thể xem các khoản đã cấn, đã hoàn hoặc đã hủy trong lịch sử.</p> : (
          <div className="space-y-3">
            {sources.map(row => <section key={row.id} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h3 className="font-semibold">Phiếu ứng {row.cashCode}</h3><p className="text-sm text-muted-foreground">{row.branchName} · {formatShortDate(row.date)}</p></div>
                <Button disabled={!tenant || !user} onClick={() => setSource(row)}>{pending(row.id) ? "Kiểm tra hoàn đang chờ" : `Nhận hoàn từ ${row.cashCode}`}</Button>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {[["Ứng ban đầu", row.originalAmount], ["Đã cấn đơn mua", row.appliedAmount ?? row.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0)], ["Đã hoàn", row.refundedAmount ?? 0], ["Còn được hoàn", row.remainingAmount]].map(([label, value]) => <div key={String(label)}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{formatCurrency(Number(value))} đ</dd></div>)}
              </dl>
              {row.note && <p className="whitespace-pre-wrap break-words text-sm">{row.note}</p>}
              {row.allocations.length > 0 && <details className="text-sm"><summary className="cursor-pointer">Xem phân bổ vào đơn mua ({row.allocations.length})</summary><ul className="mt-2 space-y-1">{row.allocations.map((allocation, index) => <li key={`${allocation.documentCode}:${index}`}>{allocation.documentCode}: {formatCurrency(allocation.amount)} đ</li>)}</ul></details>}
            </section>)}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={loading || !!source} onClick={() => setRevision(value => value + 1)}>Tải lại nguồn ứng</Button>
          <Button variant="outline" disabled={!!source} onClick={onHistory}>Xem lịch sử thu chi & phân bổ</Button>
          <Button variant="outline" disabled={!!source} onClick={onClose}>Đóng</Button>
        </div>
        {source && <RefundAdvanceDialog key={source.id} mode="supplier" partyId={partyId} partyName={partyName} source={source}
          onClose={() => { setSource(null); setRevision(value => value + 1); }}
          onSuccess={message => { setSource(null); setSuccess(message); setRevision(value => value + 1); onChanged(); }} />}
      </DialogContent>
    </Dialog>
  );
}
