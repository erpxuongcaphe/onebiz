"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  correctSupplierReceiptLine,
  getPurchaseOrderItems,
  type PurchaseOrderItemRow,
  type SupplierReceiptCorrection,
} from "@/lib/services/supabase/purchase-orders";

export function SupplierReceiptCorrectionDialog({
  order, onClose, onDone,
}: {
  order: { id: string; code: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<PurchaseOrderItemRow[]>([]);
  const [lineId, setLineId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"load" | "preview" | "apply" | null>("load");
  const [preview, setPreview] = useState<SupplierReceiptCorrection | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const line = items.find((row) => row.id === lineId);

  useEffect(() => {
    let current = true;
    getPurchaseOrderItems(order.id).then((rows) => {
      if (!current) return;
      setItems(rows);
      if (rows.length === 1) chooseLine(rows[0]);
    }).catch((cause: unknown) => {
      if (current) setError(cause instanceof Error ? cause.message : "Không tải được dòng hàng.");
    }).finally(() => {
      if (current) setPending(null);
    });
    return () => { current = false; };
  }, [order.id, loadAttempt]);

  function chooseLine(row?: PurchaseOrderItemRow) {
    setLineId(row?.id ?? "");
    setQuantity(row ? String(row.receivedQuantity) : "");
    setPrice(row ? String(row.unitPrice) : "");
    setPreview(null);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !line || !quantity || !price || reason.trim().length < 3) return;
    const token = preview?.token;
    setPending(token ? "apply" : "preview");
    setError("");
    try {
      const result = await correctSupplierReceiptLine(order.id, line.id, Number(quantity), Number(price), reason.trim(), token);
      if (token) onDone();
      else setPreview(result);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Không thể điều chỉnh phiếu.");
    } finally {
      setPending(null);
    }
  }

  const previews = preview && [
    ["Số thực nhận", formatNumber(preview.oldQuantity), formatNumber(preview.newQuantity), line?.unit],
    ["Đơn giá", formatCurrency(preview.oldUnitPrice), formatCurrency(preview.newUnitPrice), "đ"],
    ["Tồn chi nhánh", formatNumber(preview.stockBefore), formatNumber(preview.stockAfter), preview.stockUnit],
    ["Tồn lô", formatNumber(preview.lotBefore), formatNumber(preview.lotAfter), preview.stockUnit],
    ["Giá trị tồn", formatCurrency(preview.oldValue), formatCurrency(preview.newValue), "đ"],
    ["Tổng phiếu", formatCurrency(preview.oldTotal), formatCurrency(preview.newTotal), "đ"],
    ["Còn phải trả", formatCurrency(preview.oldDebt), formatCurrency(preview.newDebt), "đ"],
  ];

  return (
    <Dialog open onOpenChange={(open) => { if (!open && pending !== "apply") onClose(); }}>
      <DialogContent className="max-h-[90dvh] min-w-0 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Điều chỉnh phiếu nhập {order.code}</DialogTitle>
          <DialogDescription>Chọn một dòng hàng để sửa số thực nhận và đơn giá theo chứng từ.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {pending === "load" && <p role="status" className="text-sm text-muted-foreground">Đang tải dòng hàng…</p>}
          {!!items.length && (
            <fieldset disabled={!!pending || !!preview} className="min-w-0 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="correction-line">Mặt hàng</Label>
                <select id="correction-line" value={lineId}
                  onChange={(e) => chooseLine(items.find((row) => row.id === e.target.value))}
                  className="block min-h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">Chọn mặt hàng</option>
                  {items.map((row) => <option key={row.id} value={row.id}>{row.productName} · {row.unit}</option>)}
                </select>
              </div>
              {line && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="correction-quantity">Số thực nhận ({line.unit})</Label>
                    <Input id="correction-quantity" type="number" inputMode="decimal" min="0.0001" step="0.0001"
                      value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="correction-price">Đơn giá (đ/{line.unit})</Label>
                    <Input id="correction-price" type="number" inputMode="decimal" min="0" step="any"
                      value={price} onChange={(e) => setPrice(e.target.value)} required />
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="correction-reason">Lý do điều chỉnh</Label>
                <Textarea id="correction-reason" minLength={3} maxLength={500} rows={2}
                  value={reason} onChange={(e) => setReason(e.target.value)} required />
              </div>
            </fieldset>
          )}
          {error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
          {!items.length && !pending && (error ? (
            <Button type="button" variant="outline" onClick={() => {
              setError("");
              setPending("load");
              setLoadAttempt((value) => value + 1);
            }}>Thử tải lại</Button>
          ) : <p className="text-sm text-muted-foreground">Phiếu chưa có dòng hàng.</p>)}
          {previews && preview && (
            <div className="rounded-lg border p-3 text-sm" aria-label="Kết quả xem trước">
              <p className="font-medium">Thay đổi khi lưu</p>
              <dl className="mt-2 divide-y">
                {previews.map(([name, before, after, unit]) => (
                  <div key={name} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                    <dt>{name}</dt><dd className="tabular-nums">{before} → <strong>{after} {unit}</strong></dd>
                  </div>
                ))}
              </dl>
              {preview.usedCostDelta !== 0 && (
                <p className="pt-2 text-muted-foreground">
                  Chênh lệch giá vốn phần đã dùng {formatCurrency(preview.usedCostDelta)} đ được ghi tại thời điểm điều chỉnh.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending === "apply"} onClick={() => preview ? setPreview(null) : onClose()}>
              {preview ? "Sửa lại" : "Đóng"}
            </Button>
            <Button type="submit" disabled={!!pending || !line || !quantity || !price || reason.trim().length < 3}>
              {pending === "apply" ? "Đang lưu…" : pending === "preview" ? "Đang đối soát…" : preview ? "Xác nhận điều chỉnh" : "Xem trước chênh lệch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
