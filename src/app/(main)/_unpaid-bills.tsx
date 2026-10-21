"use client";

import { useFnbOpenOrders } from "@/lib/hooks/use-fnb-open-orders";
import { fnbOpenOrderLabel } from "@/lib/fnb-open-orders";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";

export function UnpaidBills({ tenantId, branchId }: { tenantId: string; branchId?: string }) {
  const { orders, loading, error, refresh } = useFnbOpenOrders(tenantId, branchId);
  const total = orders.reduce((sum, order) => sum + order.provisionalTotal, 0);
  const tables = new Set(orders.filter(order => order.tableId).map(order => `${order.branchId}:${order.tableId}`)).size;

  return (
    <section aria-labelledby="unpaid-bills-title" className="min-w-0 overflow-hidden rounded-md border border-amber-300/70 bg-card shadow-sm dark:border-amber-700">
      <div className="border-l-4 border-amber-500 bg-amber-500/5 p-4">
        <h2 id="unpaid-bills-title" className="text-sm font-semibold text-amber-800 dark:text-amber-300">F&B · Chưa thanh toán</h2>
        <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid="unpaid-total">{loading || error ? "—" : formatCurrency(total)}</p>
        {!loading && !error && <p className="mt-1 text-sm">{formatNumber(orders.length)} bill · {formatNumber(tables)} bàn</p>}
        <p className="mt-2 text-xs text-muted-foreground">Tạm tính các bill còn mở, gồm ngày trước. Chưa tính vào doanh số và thực thu.</p>
      </div>
      {loading && <p role="status" className="p-4 text-sm text-muted-foreground">Đang tải bill chưa thanh toán...</p>}
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"><span>Chưa tải được bill chưa thanh toán.</span><Button variant="outline" size="sm" onClick={() => void refresh()}>Thử lại</Button></div>}
      {!loading && !error && <details className="border-t border-amber-200/60 p-4 dark:border-amber-800">
        <summary className="min-h-6 cursor-pointer text-sm font-semibold text-amber-800 dark:text-amber-300">Xem các bill chờ thu ({formatNumber(orders.length)})</summary>
        {orders.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Không có bill chưa thanh toán.</p> : <ul className="mt-3 divide-y">
          {orders.map(order => <li key={order.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
            <div className="min-w-0 flex-1 basis-40 break-words"><p className="font-semibold">{order.orderNumber} · {fnbOpenOrderLabel(order)}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}{order.createdByName ? ` · ${order.createdByName}` : ""}</p></div>
            <span className="font-semibold tabular-nums">{formatCurrency(order.provisionalTotal)}</span>
          </li>)}
        </ul>}
      </details>}
    </section>
  );
}
