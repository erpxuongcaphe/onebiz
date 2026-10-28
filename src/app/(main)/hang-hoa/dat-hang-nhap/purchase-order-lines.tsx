"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { getPurchaseOrderItems, type PurchaseOrderItemRow } from "@/lib/services/supabase/purchase-orders";

/** Read the saved request, including orders already processed by the warehouse. */
export function PurchaseOrderLines({ orderId }: { orderId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ id: string; rows: PurchaseOrderItemRow[]; error: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    getPurchaseOrderItems(orderId).then(
      rows => { if (active) setResult({ id: orderId, rows, error: false }); },
      () => { if (active) setResult({ id: orderId, rows: [], error: true }); },
    );
    return () => { active = false; };
  }, [orderId, attempt]);

  const current = result?.id === orderId ? result : null;
  return <section aria-label="Mặt hàng đã đặt" className="space-y-2">
    <h3 className="text-sm font-semibold">Mặt hàng đã đặt{current && !current.error ? ` (${current.rows.length})` : ""}</h3>
    {!current ? <p role="status" className="text-sm text-muted-foreground">Đang tải mặt hàng…</p>
      : current.error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        Chưa tải được mặt hàng đã đặt.
        <Button variant="outline" size="sm" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>Thử lại</Button>
      </div>
      : !current.rows.length ? <p className="text-sm text-muted-foreground">Phiếu chưa có mặt hàng.</p>
      : <div className="max-w-3xl overflow-x-auto rounded-md border">
        <table className="w-full min-w-[560px] table-fixed text-sm">
          <colgroup><col className="w-[38%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[38%]" /></colgroup>
          <thead className="bg-muted/50"><tr>
            <th className="p-2 text-left font-medium">Mặt hàng</th>
            <th className="p-2 text-right font-medium whitespace-nowrap">SL đặt</th>
            <th className="p-2 text-left font-medium">ĐVT</th>
            <th className="p-2 text-left font-medium">Ghi chú</th>
          </tr></thead>
          <tbody>{current.rows.map(row => <tr key={row.id} className="border-t align-top">
            <td className="p-2"><div className="break-words font-medium">{row.productName}</div>
              {row.productCode && <div className="text-xs text-muted-foreground">{row.productCode}</div>}
            </td>
            <td className="p-2 text-right tabular-nums whitespace-nowrap">{formatNumber(row.quantity)}</td>
            <td className="p-2 whitespace-nowrap">{row.unit}</td>
            <td className="p-2 whitespace-pre-wrap break-words text-muted-foreground">{row.note?.trim() ? row.note : "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}
