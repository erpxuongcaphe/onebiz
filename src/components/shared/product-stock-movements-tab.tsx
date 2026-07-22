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
import { useToast } from "@/lib/contexts";
import { exportToExcel } from "@/lib/utils/export";
import { REFERENCE_TYPE_LABELS } from "@/lib/constants/stock-movement-refs";
import {
  getSignedStockQuantity,
  getStockMovementTotalValue,
  getStockMovementUnitValue,
} from "@/lib/stock-movement-values";

interface ProductStockMovementsTabProps {
  productId: string;
  productCode: string;
  productName: string;
  branchId?: string;
  branchName?: string;
  canViewCost?: boolean;
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

export function ProductStockMovementsTab({
  productId,
  productCode,
  productName,
  branchId,
  branchName,
  canViewCost = false,
}: ProductStockMovementsTabProps) {
  const { toast } = useToast();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drift, setDrift] = useState<{ computed: number; system: number } | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStockCard(productId, branchId)
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
  }, [productId, branchId]);

  const gridColumns = branchId
    ? canViewCost
      ? "grid-cols-[110px_130px_150px_70px_90px_110px_90px_170px_140px] min-w-[1140px]"
      : "grid-cols-[110px_130px_150px_70px_90px_170px_140px] min-w-[930px]"
    : canViewCost
      ? "grid-cols-[110px_130px_150px_70px_150px_90px_110px_90px_170px_140px] min-w-[1300px]"
      : "grid-cols-[110px_130px_150px_70px_150px_90px_170px_140px] min-w-[1090px]";

  const handleExportExcel = async () => {
    if (movements.length === 0 || exporting) return;
    setExporting(true);
    try {
      const scopeName = branchId ? branchName ?? "Chi nhánh đã chọn" : "Toàn chuỗi";
      const columns = [
        { header: "Mã hàng", key: "productCode", width: 16 },
        { header: "Tên hàng", key: "productName", width: 28 },
        { header: "Phạm vi", key: "scopeName", width: 24 },
        { header: "Ngày", key: "date", width: 18, format: (value: string) => formatDate(value) },
        { header: "Mã phiếu", key: "referenceCode", width: 16 },
        { header: "Loại chứng từ", key: "referenceTypeName", width: 24 },
        { header: "Hướng", key: "typeName", width: 14 },
        { header: "Số lượng biến động", key: "signedQuantity", width: 20 },
        ...(!branchId ? [{ header: "Chi nhánh", key: "branchName", width: 26 }] : []),
        ...(canViewCost
          ? [
              { header: "Đơn giá", key: "unitValue", width: 16 },
              { header: "Giá trị", key: "movementValue", width: 18 },
            ]
          : []),
        { header: "Tồn cuối", key: "runningBalance", width: 14 },
        { header: "Đối tác/Bộ phận", key: "partner", width: 26 },
        { header: "Người tạo", key: "createdByName", width: 20 },
        { header: "Ghi chú", key: "note", width: 42 },
      ];
      const rows = movements.map((movement) => ({
        ...movement,
        productCode,
        productName,
        scopeName,
        referenceCode: movement.referenceCode ?? movement.code ?? "—",
        referenceTypeName:
          REFERENCE_TYPE_LABELS[movement.referenceType ?? ""] ?? movement.referenceType ?? "—",
        signedQuantity: getSignedStockQuantity(movement),
        unitValue: getStockMovementUnitValue(movement),
        movementValue: getStockMovementTotalValue(movement),
      }));
      const safeCode = productCode.replace(/[^a-zA-Z0-9_-]+/g, "-");
      const safeScope = scopeName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      const today = new Date().toISOString().slice(0, 10);
      await exportToExcel(rows, columns, `the-kho_${safeCode}_${safeScope}_${today}`);
      toast({
        title: "Đã xuất Excel thẻ kho",
        description: `${movements.length} giao dịch · ${scopeName}`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Xuất Excel thẻ kho thất bại",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  };

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <span className="text-xs text-muted-foreground">
          Hiển thị {Math.min(visibleLimit, movements.length)}/{movements.length} giao dịch
          {branchId ? ` tại ${branchName ?? "chi nhánh đã chọn"}` : " (toàn chuỗi)"}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-muted-foreground">Tổng: {formatNumber(total)}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleExportExcel()}
            disabled={exporting}
            className="shrink-0 gap-2"
          >
            <Icon
              name={exporting ? "progress_activity" : "table_view"}
              size={15}
              className={exporting ? "animate-spin" : undefined}
            />
            {exporting ? "Đang xuất..." : "Xuất Excel thẻ kho"}
          </Button>
        </div>
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
        <div className={`grid ${gridColumns} gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground`}>
          <span>Ngày</span>
          <span>Mã phiếu</span>
          <span>Loại</span>
          <span className="text-right">SL</span>
          {!branchId && <span>Chi nhánh</span>}
          {canViewCost && <span className="text-right">Đơn giá</span>}
          {canViewCost && <span className="text-right">Giá trị</span>}
          <span className="text-right">Tồn cuối</span>
          <span>Đối tác</span>
          <span>Ghi chú</span>
        </div>

        <ul className={`divide-y ${gridColumns}`}>
          {movements.slice(0, visibleLimit).map((m) => {
            const style = TYPE_STYLE[m.type] ?? TYPE_STYLE.import;
            const signed = getSignedStockQuantity(m);
            const unitValue = getStockMovementUnitValue(m);
            const totalValue = getStockMovementTotalValue(m);
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
                className={`grid ${gridColumns} gap-2 items-center px-3 py-2 text-sm`}
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
                {!branchId && (
                  <span className="truncate text-xs" title={m.branchName ?? ""}>
                    {m.branchName ?? "—"}
                  </span>
                )}
                {canViewCost && (
                  <span className="text-right tabular-nums text-xs">
                    {unitValue != null ? formatCurrency(unitValue) : "—"}
                  </span>
                )}
                {canViewCost && (
                  <span className="text-right tabular-nums text-xs font-medium">
                    {totalValue != null ? formatCurrency(totalValue) : "—"}
                  </span>
                )}
                {/* Tồn cuối theo đúng phạm vi chi nhánh đang xem. */}
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
