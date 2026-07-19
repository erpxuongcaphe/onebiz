"use client";

// ProductStockMovementsTab — "Thẻ kho" cho 1 sản phẩm trong inline-detail-panel.
// Query `stock_movements` filter product_id + paginate mới nhất trước.
// Hiển thị timeline: nhập / xuất / kiểm kho / chuyển kho, kèm số lượng +,-
// để CEO truy vết tồn kho.

import { useEffect, useState } from "react";
import { getStockCard } from "@/lib/services";
import { formatDate, formatNumber, formatCurrency } from "@/lib/format";
import type { StockMovement } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { StockDocumentLink } from "@/components/shared/stock-document-link";

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
  const [visibleLimit, setVisibleLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Đợt 4 (17/07): thẻ kho ở chi tiết SP KHÔNG lọc chi nhánh → tồn cuối là tồn
  // TOÀN CÔNG TY sau mỗi giao dịch; drift đối soát với products.stock.
  const [drift, setDrift] = useState<{ computed: number; system: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVisibleLimit(50);

    getStockCard(productId)
      .then((result) => {
        if (!cancelled) {
          setMovements(result.data);
          setTotal(result.total);
          setDrift({ computed: result.computedFinal, system: result.systemStock });
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
        <span>Hiển thị {Math.min(visibleLimit, movements.length)}/{movements.length} giao dịch (toàn công ty)</span>
        <span>Tổng: {formatNumber(total)}</span>
      </div>

      {/* Đợt 4: băng cảnh báo khi tồn cộng dồn từ sổ ≠ products.stock. */}
      {drift && Math.abs(drift.computed - drift.system) > 0.001 && (
        <div className="rounded-md border-l-4 border-status-warning bg-status-warning/10 px-3 py-2 text-xs">
          <div className="font-medium text-status-warning">
            Sổ lệch tồn hệ thống {formatNumber(drift.computed - drift.system)}
          </div>
          <div className="text-muted-foreground">
            Tồn cộng dồn từ sổ <b>{formatNumber(drift.computed)}</b> · tồn hệ
            thống <b>{formatNumber(drift.system)}</b>. Nên đối soát.
          </div>
        </div>
      )}

      {/* Day 17/05: overflow-x-auto cho laptop nhỏ.
          CEO 10/06/2026: thay cột "Còn lại" (để "—") bằng "Đối tác" thật.
          Đợt 4 (17/07): thêm lại cột "Tồn cuối" ĐÚNG (cộng dồn từ sổ). */}
      <div className="rounded-lg border overflow-x-auto">
        <div className="grid grid-cols-[110px_130px_150px_70px_90px_110px_90px_170px_140px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground min-w-[1140px]">
          <span>Ngày</span>
          <span>Mã phiếu</span>
          <span>Loại</span>
          <span className="text-right">SL</span>
          {/* Đợt 6 (19/07): đơn giá + giá trị */}
          <span className="text-right">Đơn giá</span>
          <span className="text-right">Giá trị</span>
          <span className="text-right">Tồn cuối</span>
          <span>Đối tác</span>
          <span>Ghi chú</span>
        </div>

        <ul className="divide-y min-w-[1000px]">
          {movements.slice(0, visibleLimit).map((m) => {
            const style = TYPE_STYLE[m.type] ?? TYPE_STYLE.import;
            const signed = m.type === "export" ? -Math.abs(m.quantity) : m.quantity;
            const partnerColor: Record<NonNullable<typeof m.partnerType>, string> = {
              customer: "text-blue-600",
              supplier: "text-emerald-600",
              branch: "text-purple-600",
              system: "text-muted-foreground italic",
            };
            const pColor = m.partnerType ? partnerColor[m.partnerType] : "text-muted-foreground";
            return (
              <li
                key={m.id}
                className="grid grid-cols-[110px_130px_150px_70px_90px_110px_90px_170px_140px] gap-2 items-center px-3 py-2 text-sm"
              >
                <span className="text-xs text-muted-foreground">
                  {formatDate(m.date)}
                </span>
                <StockDocumentLink
                  referenceType={m.referenceType}
                  referenceId={m.referenceId}
                  code={m.referenceCode ?? m.code}
                />
                <span className={`flex items-center gap-2 ${style.color}`}>
                  <Icon name={style.icon} size={14} />
                  <span className="truncate">{m.typeName || style.label}</span>
                </span>
                <span
                  className={`text-right font-mono ${
                    signed < 0 ? "text-destructive" : "text-status-success"
                  }`}
                >
                  {signed > 0 ? "+" : ""}
                  {formatNumber(signed)}
                </span>
                {/* Đợt 6: đơn giá + giá trị (nhập→giá phiếu, xuất→giá vốn). */}
                {(() => {
                  const up = m.type === "export" ? m.unitCost : (m.unitPrice ?? m.unitCost);
                  return (
                    <>
                      <span className="text-right tabular-nums text-xs">
                        {up != null ? formatCurrency(up) : "—"}
                      </span>
                      <span className="text-right tabular-nums text-xs font-medium">
                        {up != null ? formatCurrency(up * Math.abs(m.quantity)) : "—"}
                      </span>
                    </>
                  );
                })()}
                {/* Đợt 4: Tồn cuối toàn công ty sau giao dịch. */}
                <span className="text-right font-medium tabular-nums">
                  {m.runningBalance != null ? formatNumber(m.runningBalance) : "—"}
                </span>
                <span className={`text-xs truncate ${pColor}`} title={m.partner ?? ""}>
                  {m.partner ?? "—"}
                </span>
                <span className="text-xs text-muted-foreground truncate" title={m.note ?? ""}>
                  {m.note ?? ""}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {visibleLimit < movements.length && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVisibleLimit((current) => current + 50)}
          >
            <Icon name="expand_more" size={15} />
            Xem thêm 50 giao dịch
          </Button>
        </div>
      )}
    </div>
  );
}
