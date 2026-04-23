"use client";

// ProductStockMovementsTab — "Thẻ kho" cho 1 sản phẩm trong inline-detail-panel.
// Query `stock_movements` filter product_id + paginate mới nhất trước.
// Hiển thị timeline: nhập / xuất / kiểm kho / chuyển kho, kèm số lượng +,-
// để CEO truy vết tồn kho.

import { useEffect, useState } from "react";
import { getProductStockMovements } from "@/lib/services";
import { formatDate } from "@/lib/format";
import type { StockMovement } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

interface ProductStockMovementsTabProps {
  productId: string;
}

const TYPE_STYLE: Record<
  StockMovement["type"],
  { icon: string; label: string; color: string }
> = {
  import: { icon: "input", label: "Nhập kho", color: "text-status-success" },
  export: { icon: "output", label: "Xuất kho", color: "text-destructive" },
  adjustment: { icon: "fact_check", label: "Kiểm kho", color: "text-status-info" },
  transfer: { icon: "sync_alt", label: "Chuyển kho", color: "text-status-warning" },
  return: { icon: "undo", label: "Trả hàng", color: "text-muted-foreground" },
};

export function ProductStockMovementsTab({ productId }: ProductStockMovementsTabProps) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getProductStockMovements(productId, { page: 0, pageSize: 30 })
      .then((result) => {
        if (!cancelled) {
          setMovements(result.data);
          setTotal(result.total);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Không tải được thẻ kho");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Icon name="progress_activity" size={16} className="animate-spin mr-2" />
        <span className="text-sm">Đang tải thẻ kho...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive bg-destructive/5 rounded-lg p-3 flex items-center gap-2">
        <Icon name="warning" size={16} />
        {error}
      </div>
    );
  }

  if (movements.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <Icon name="receipt_long" size={40} className="mb-2 opacity-30" />
        <p className="text-sm">Chưa có giao dịch kho</p>
        <p className="text-xs mt-1">
          Thẻ kho sẽ ghi nhận mỗi lần nhập/xuất/kiểm kho/chuyển kho
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>Hiển thị {movements.length} giao dịch gần nhất</span>
        <span>Tổng: {total}</span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="grid grid-cols-[110px_1fr_90px_90px_140px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
          <span>Ngày</span>
          <span>Loại</span>
          <span className="text-right">SL</span>
          <span className="text-right">Còn lại</span>
          <span>Ghi chú</span>
        </div>

        <ul className="divide-y">
          {movements.map((m) => {
            const style = TYPE_STYLE[m.type] ?? TYPE_STYLE.import;
            const signed = m.type === "export" ? -Math.abs(m.quantity) : m.quantity;
            return (
              <li
                key={m.id}
                className="grid grid-cols-[110px_1fr_90px_90px_140px] gap-2 items-center px-3 py-2 text-sm"
              >
                <span className="text-xs text-muted-foreground">
                  {formatDate(m.date)}
                </span>
                <span className={`flex items-center gap-1.5 ${style.color}`}>
                  <Icon name={style.icon} size={14} />
                  <span className="truncate">{m.typeName || style.label}</span>
                </span>
                <span
                  className={`text-right font-mono ${
                    signed < 0 ? "text-destructive" : "text-status-success"
                  }`}
                >
                  {signed > 0 ? "+" : ""}
                  {signed}
                </span>
                <span className="text-right text-xs text-muted-foreground">—</span>
                <span className="text-xs text-muted-foreground truncate">
                  {m.note ?? ""}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
