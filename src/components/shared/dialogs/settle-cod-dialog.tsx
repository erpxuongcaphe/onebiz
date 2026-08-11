"use client";

/**
 * Đối soát COD với đối tác giao hàng (Đợt A3, 04/08 — kiểu KiotViet):
 * tick các vận đơn ĐÃ GIAO chưa đối soát → nhập phí trả đối tác từng đơn
 * (nếu có) → chọn tiền mặt / chuyển khoản → Xác nhận. Một RPC nguyên tử lo
 * trọn: phiếu đối soát DS + phiếu thu từng hóa đơn (hết treo nợ khách) +
 * 1 phiếu chi phí giao + cột "COD đang giữ" của đối tác tự giảm.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/contexts";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  getUnsettledShipments,
  settleCod,
  type UnsettledShipment,
} from "@/lib/services/supabase/shipping";
import { Icon } from "@/components/ui/icon";

interface SettleCodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = nhóm vận đơn chưa gán đối tác */
  partnerId: string | null;
  partnerName: string;
  branchId?: string;
  onSuccess?: () => void;
}

export function SettleCodDialog({
  open,
  onOpenChange,
  partnerId,
  partnerName,
  branchId,
  onSuccess,
}: SettleCodDialogProps) {
  const { toast } = useToast();
  const [shipments, setShipments] = useState<UnsettledShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [fees, setFees] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">("transfer");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChecked(new Set());
    setFees({});
    setNote("");
    setSaving(false);
    setLoading(true);
    setLoadError(null);
    getUnsettledShipments(partnerId, branchId)
      .then((rows) => {
        setShipments(rows);
        // mặc định tick hết — thao tác phổ biến là đối soát trọn kỳ
        setChecked(new Set(rows.map((r) => r.id)));
      })
      .catch((err) => {
        setShipments([]);
        setLoadError(
          err instanceof Error ? err.message : "Không tải được danh sách vận đơn",
        );
      })
      .finally(() => setLoading(false));
  }, [branchId, open, partnerId]);

  const selected = useMemo(
    () => shipments.filter((s) => checked.has(s.id)),
    [shipments, checked],
  );
  const totalCod = selected.reduce((sum, s) => sum + s.codAmount, 0);
  const totalFee = selected.reduce((sum, s) => sum + (fees[s.id] ?? 0), 0);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setChecked((prev) =>
      prev.size === shipments.length
        ? new Set()
        : new Set(shipments.map((s) => s.id)),
    );

  async function handleConfirm() {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const result = await settleCod({
        partnerId,
        items: selected.map((s) => ({
          shipmentId: s.id,
          partnerFee: fees[s.id] ?? 0,
        })),
        paymentMethod,
        note: note.trim() || null,
      });
      onOpenChange(false);
      toast({
        title: `Đã đối soát ${result.code}`,
        description:
          `Thu ${formatCurrency(result.totalCod)}` +
          (result.totalPartnerFee > 0
            ? ` − phí ${formatCurrency(result.totalPartnerFee)} = thực nhận ${formatCurrency(result.netAmount)}`
            : "") +
          ` · ${result.receipts} phiếu thu vào sổ quỹ, công nợ khách đã trừ.`,
        variant: "success",
        duration: 8000,
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Không đối soát được",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Đối soát COD — {partnerName}</DialogTitle>
          <DialogDescription>
            Tick các vận đơn đối tác đã nộp tiền. Xác nhận xong: tiền vào sổ
            quỹ, công nợ khách được trừ, "COD đang giữ" của đối tác giảm tương
            ứng.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Icon name="progress_activity" size={18} className="mr-2 inline animate-spin" />
            Đang tải vận đơn đã giao...
          </div>
        ) : loadError ? (
          <div className="rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-3 text-sm">
            {loadError}
          </div>
        ) : shipments.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Chưa có vận đơn nào <b>đã giao</b> chờ đối soát với {partnerName}.
            <br />
            Vận đơn phải chuyển sang trạng thái "Đã giao" trước rồi mới đối soát
            được.
          </div>
        ) : (
          <>
            <div className="max-h-[42vh] overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="w-9 px-2 py-2">
                      <input
                        type="checkbox"
                        checked={checked.size === shipments.length && shipments.length > 0}
                        onChange={toggleAll}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                    </th>
                    <th className="px-2 py-2">Vận đơn</th>
                    <th className="px-2 py-2">Hóa đơn</th>
                    <th className="px-2 py-2">Khách</th>
                    <th className="px-2 py-2">Ngày giao</th>
                    <th className="px-2 py-2 text-right">COD</th>
                    <th className="w-32 px-2 py-2 text-right">Phí trả đối tác</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={checked.has(s.id)}
                          onChange={() => toggle(s.id)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                      </td>
                      <td className="px-2 py-1.5 font-medium">{s.code}</td>
                      <td className="px-2 py-1.5">{s.invoiceCode}</td>
                      <td className="max-w-[180px] truncate px-2 py-1.5">{s.customerName}</td>
                      <td className="px-2 py-1.5">{formatDate(s.deliveredAt)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatCurrency(s.codAmount)}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          value={fees[s.id] || ""}
                          onChange={(e) =>
                            setFees((prev) => ({
                              ...prev,
                              [s.id]: Math.max(0, Number(e.target.value) || 0),
                            }))
                          }
                          placeholder="0"
                          disabled={!checked.has(s.id)}
                          className="h-7 w-full rounded border border-input bg-transparent px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring disabled:opacity-40"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">
                  Tổng COD ({selected.length} đơn)
                </div>
                <div className="font-semibold tabular-nums">{formatCurrency(totalCod)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Phí trả đối tác</div>
                <div className="font-semibold tabular-nums">{formatCurrency(totalFee)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Thực nhận</div>
                <div className="font-semibold tabular-nums text-status-success">
                  {formatCurrency(totalCod - totalFee)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nhận tiền qua</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as "cash" | "transfer")}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
                >
                  <option value="transfer">Chuyển khoản</option>
                  <option value="cash">Tiền mặt</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Ghi chú</label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Số chứng từ bên đối tác..."
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
                />
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={saving || loading || selected.length === 0}
          >
            {saving && (
              <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />
            )}
            Xác nhận đối soát {selected.length > 0 ? `(${selected.length} đơn)` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
