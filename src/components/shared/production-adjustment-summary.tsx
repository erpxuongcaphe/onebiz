"use client";
import type { ProductionAdjustmentPreview } from "@/lib/services/supabase/production";
import { formatCurrency, formatNumber } from "@/lib/format";
const signed=(n:number, money=false)=>`${n>0?"+":""}${money?`${formatCurrency(n)} đ`:formatNumber(n)}`;
export function ProductionAdjustmentSummary({preview:p}:{preview:ProductionAdjustmentPreview}) {
  return <div className="space-y-3 text-sm">
    <div className="rounded-lg border p-3"><div className="font-semibold">{p.productName}</div>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>Tổng mẻ trước → sau<strong className="block">{formatNumber(p.outputBefore)} → {formatNumber(p.outputAfter)} {p.unit}</strong></div>
        <div>Đã dùng (giữ nguyên)<strong className="block">{formatNumber(p.usedQuantity)} {p.unit}</strong></div>
        <div>Còn lại của mẻ<strong className="block">{formatNumber(p.remainingBefore)} → {formatNumber(p.remainingAfter)} {p.unit}</strong></div>
        <div>Chênh lệch kho<strong className="block">{signed(p.stockDelta)} {p.unit}</strong></div>
      </div>
      <p className="mt-3 border-t pt-2">Tồn chi nhánh: <strong>{formatNumber(p.stockBefore)} → {formatNumber(p.stockAfter)} {p.unit}</strong></p>
    </div>
    <div className="space-y-2"><h3 className="font-semibold">Nguyên liệu — chỉ ghi phần chênh lệch</h3>
      {p.materials.map(m=><div key={m.productId} className="grid gap-1 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div><strong>{m.productName}</strong><div>Thực dùng: {formatNumber(m.before)} → {formatNumber(m.after)} {m.unit}</div></div>
        <div className="sm:text-right"><strong>Kho {signed(m.stockDelta)} {m.unit}</strong><div>Tồn: {formatNumber(m.stockBefore)} → {formatNumber(m.stockAfter)}</div><div>Giá trị kho {signed(m.costDelta,true)}</div></div>
      </div>)}
    </div>
    <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-3">
      <div>Giá vốn cả mẻ<strong className="block">{formatCurrency(p.batchCostBefore)} → {formatCurrency(p.batchCostAfter)} đ</strong></div>
      <div>Giá trị thành phẩm còn kho<strong className="block">{signed(p.inventoryCostDelta,true)}</strong></div>
      <div>Giá vốn phần đã dùng<strong className="block">{signed(p.usedCostDelta,true)}</strong></div>
    </div>
    <p className="text-sm text-foreground">Chênh lệch giá vốn phần đã dùng được ghi riêng tại ngày điều chỉnh, không tính lại bill, tiền thanh toán hoặc công thức đã lưu trên bill.</p>
  </div>;
}
