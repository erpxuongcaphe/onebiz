"use client";

// ProductLotsTab — hiển thị danh sách lô của một sản phẩm (NVL hoặc SKU)
// Dùng trong inline-detail-panel của trang Hàng hóa.
// Sort FIFO theo expiry_date, kèm badge HSD + cảnh báo.

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, Package } from "lucide-react";
import { getProductLots } from "@/lib/services";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ProductLot } from "@/lib/types";

interface ProductLotsTabProps {
  productId: string;
  branchId?: string;
}

export function ProductLotsTab({ productId, branchId }: ProductLotsTabProps) {
  const [lots, setLots] = useState<ProductLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProductLots(productId, branchId)
      .then((data) => {
        if (!cancelled) setLots(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Không thể tải danh sách lô");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, branchId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">Đang tải lô...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive bg-destructive/5 rounded-lg p-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  if (lots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <Package className="h-10 w-10 mb-2 opacity-30" />
        <p className="text-sm">Sản phẩm chưa có lô nào</p>
        <p className="text-xs mt-1">
          Lô sẽ được tạo khi nhập hàng từ NCC hoặc hoàn thành lệnh sản xuất
        </p>
      </div>
    );
  }

  const activeLots = lots.filter((l) => l.currentQty > 0);
  const totalStock = activeLots.reduce((sum, l) => sum + l.currentQty, 0);
  const expiredCount = activeLots.filter((l) => l.expiryStatus === "expired").length;
  const expiringSoonCount = activeLots.filter(
    (l) => l.expiryStatus === "expiring_soon"
  ).length;

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard
          label="Tổng tồn"
          value={formatCurrency(totalStock)}
          tone="default"
        />
        <SummaryCard
          label="Sắp hết hạn"
          value={String(expiringSoonCount)}
          tone={expiringSoonCount > 0 ? "warning" : "default"}
        />
        <SummaryCard
          label="Đã hết hạn"
          value={String(expiredCount)}
          tone={expiredCount > 0 ? "error" : "default"}
        />
      </div>

      {/* Lot list */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left p-2 font-medium">Số lô</th>
              <th className="text-left p-2 font-medium">Chi nhánh</th>
              <th className="text-right p-2 font-medium">Tồn</th>
              <th className="text-left p-2 font-medium">Ngày SX</th>
              <th className="text-left p-2 font-medium">HSD</th>
              <th className="text-center p-2 font-medium">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr key={lot.id} className="border-t">
                <td className="p-2">
                  <div className="font-medium">{lot.lotNumber}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {lot.sourceType === "production" ? "Sản xuất" : "Nhập mua"}
                  </div>
                </td>
                <td className="p-2 text-muted-foreground">{lot.branchName ?? "—"}</td>
                <td className="p-2 text-right">
                  <span className="font-medium">{formatCurrency(lot.currentQty)}</span>
                  {lot.initialQty > lot.currentQty && (
                    <span className="block text-xs text-muted-foreground">
                      / {formatCurrency(lot.initialQty)}
                    </span>
                  )}
                </td>
                <td className="p-2 text-muted-foreground">
                  {lot.manufacturedDate ? formatDate(lot.manufacturedDate) : "—"}
                </td>
                <td className="p-2">
                  {lot.expiryDate ? formatDate(lot.expiryDate) : "—"}
                </td>
                <td className="p-2 text-center">
                  <ExpiryBadge
                    status={lot.expiryStatus}
                    daysUntilExpiry={lot.daysUntilExpiry}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Lô được sắp xếp theo FIFO — lô gần hết hạn / nhập kho sớm nhất sẽ xuất trước.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "default" | "warning" | "error";
}) {
  const toneClass =
    tone === "error"
      ? "text-destructive"
      : tone === "warning"
        ? "text-yellow-600"
        : "text-foreground";
  return (
    <div className="border rounded-lg p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold mt-0.5 ${toneClass}`}>{value}</div>
    </div>
  );
}

function ExpiryBadge({
  status,
  daysUntilExpiry,
}: {
  status?: ProductLot["expiryStatus"];
  daysUntilExpiry?: number;
}) {
  if (!status || status === "no_expiry") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (status === "expired") {
    return (
      <span className="inline-flex items-center gap-1 text-destructive text-xs font-medium">
        <AlertTriangle className="h-3.5 w-3.5" />
        Hết hạn
        {typeof daysUntilExpiry === "number" && ` ${Math.abs(daysUntilExpiry)}d`}
      </span>
    );
  }
  if (status === "expiring_soon") {
    return (
      <span className="inline-flex items-center gap-1 text-yellow-600 text-xs font-medium">
        <CalendarClock className="h-3.5 w-3.5" />
        Còn {daysUntilExpiry ?? 0} ngày
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-green-600 text-xs">
      <CheckCircle2 className="h-3.5 w-3.5" />
      {typeof daysUntilExpiry === "number" ? `${daysUntilExpiry}d` : "OK"}
    </span>
  );
}
