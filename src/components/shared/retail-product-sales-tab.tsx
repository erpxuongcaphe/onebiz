"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, formatStockQuantity } from "@/lib/format";
import { getSalesHistory } from "@/lib/services";
import type { QueryResult, SalesHistory } from "@/lib/types";

const pageSize = 25;

export function RetailProductSalesTab({ productId, branchId }: { productId: string; branchId?: string }) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<QueryResult<SalesHistory> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getSalesHistory(productId, { page, pageSize, branchId }).then(
      (data) => { if (active) setResult(data); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [productId, branchId, page, attempt]);

  function moveTo(next: number) {
    setResult(null);
    setFailed(false);
    if (next === page) setAttempt((value) => value + 1);
    else setPage(next);
  }

  if (failed) return (
    <div role="alert" className="flex items-center gap-3 p-3 text-sm text-destructive">
      Không tải được lịch sử bán.
      <Button size="sm" variant="outline" onClick={() => moveTo(page)}>Thử lại</Button>
    </div>
  );
  if (!result) return <p role="status" className="p-3 text-sm text-muted-foreground">Đang tải lịch sử bán…</p>;
  if (!result.data.length) return <p className="p-3 text-sm text-muted-foreground">Chưa có hóa đơn Retail hoàn thành trong phạm vi đang xem.</p>;

  return (
    <div className="space-y-2 p-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th scope="col" className="p-2">Hóa đơn</th>
              <th scope="col" className="p-2">Ngày bán</th>
              <th scope="col" className="p-2">Khách hàng</th>
              <th scope="col" className="p-2 text-right">SL</th>
              <th scope="col" className="p-2 text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((line) => (
              <tr key={line.id} className="border-t">
                <td className="whitespace-nowrap p-2">{line.invoiceCode}</td>
                <td className="whitespace-nowrap p-2">{formatDate(line.date)}</td>
                <td className="p-2">{line.customerName || "Khách lẻ"}</td>
                <td className="p-2 text-right tabular-nums">{formatStockQuantity(line.quantity)}</td>
                <td className="whitespace-nowrap p-2 text-right tabular-nums">{formatCurrency(line.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(page > 1 || result.total > pageSize) && (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => moveTo(page - 1)}>Trước</Button>
          <span className="text-sm">Trang {page}</span>
          <Button size="sm" variant="outline" disabled={page * pageSize >= result.total} onClick={() => moveTo(page + 1)}>Sau</Button>
        </div>
      )}
    </div>
  );
}
