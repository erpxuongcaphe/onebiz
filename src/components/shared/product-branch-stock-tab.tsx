"use client";

// ProductBranchStockTab — hiển thị tồn kho của 1 sản phẩm ở TẤT CẢ chi nhánh.
// CEO Q2: "chi nhánh nào còn tồn" → không cần khái niệm "vị trí kho" abstract,
// mà đi thẳng vào số liệu branch_stock theo chi nhánh (xưởng, kho tổng, 3 quán).
//
// Dùng `getProductStockBreakdown(productId)` có sẵn — trả về list kèm
// branchName + branchCode + reserved + available, sort theo quantity desc.

import { useEffect, useState } from "react";
import { getProductStockBreakdown } from "@/lib/services";
import { formatDate, formatNumber } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

interface ProductBranchStockTabProps {
  productId: string;
  unit?: string;
}

interface BranchStockRow {
  branchId: string;
  branchName: string;
  branchCode?: string;
  quantity: number;
  reserved: number;
  available: number;
  updatedAt: string;
}

export function ProductBranchStockTab({ productId, unit }: ProductBranchStockTabProps) {
  const [rows, setRows] = useState<BranchStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getProductStockBreakdown(productId)
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Không tải được tồn kho theo chi nhánh",
          );
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
        <span className="text-sm">Đang tải tồn kho...</span>
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

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <Icon name="store" size={40} className="mb-2 opacity-30" />
        <p className="text-sm">Chưa có tồn kho ở chi nhánh nào</p>
        <p className="text-xs mt-1">
          Tồn kho sẽ cập nhật sau lần nhập hàng / chuyển kho đầu tiên
        </p>
      </div>
    );
  }

  // Chỉ tính "Tổng" từ chi nhánh có quantity > 0 để CEO nhìn nhanh còn bao
  // nhiêu hàng đang lưu kho thực tế. Reserved vẫn cộng vào total vì nó là
  // hàng đã giữ chỗ chứ chưa xuất.
  const total = rows.reduce((sum, r) => sum + r.quantity, 0);
  const totalReserved = rows.reduce((sum, r) => sum + r.reserved, 0);
  const totalAvailable = total - totalReserved;
  const unitLabel = unit ?? "";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border px-3 py-2">
          <p className="text-xs text-muted-foreground">Tổng tồn</p>
          <p className="text-base font-semibold">
            {formatNumber(total)} {unitLabel}
          </p>
        </div>
        <div className="rounded-lg border px-3 py-2">
          <p className="text-xs text-muted-foreground">Đang giữ chỗ</p>
          <p className="text-base font-semibold text-status-warning">
            {formatNumber(totalReserved)} {unitLabel}
          </p>
        </div>
        <div className="rounded-lg border px-3 py-2">
          <p className="text-xs text-muted-foreground">Có thể bán</p>
          <p className="text-base font-semibold text-status-success">
            {formatNumber(totalAvailable)} {unitLabel}
          </p>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="grid grid-cols-[1fr_90px_90px_90px_120px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
          <span>Chi nhánh</span>
          <span className="text-right">Tồn</span>
          <span className="text-right">Giữ chỗ</span>
          <span className="text-right">Còn lại</span>
          <span>Cập nhật</span>
        </div>

        <ul className="divide-y">
          {rows.map((r) => (
            <li
              key={r.branchId}
              className="grid grid-cols-[1fr_90px_90px_90px_120px] gap-2 items-center px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <Icon
                  name="store"
                  size={14}
                  className="text-muted-foreground shrink-0"
                />
                <span className="truncate">
                  {r.branchCode ? `${r.branchCode} — ` : ""}
                  {r.branchName}
                </span>
              </span>
              <span
                className={`text-right font-mono ${
                  r.quantity === 0 ? "text-muted-foreground" : ""
                }`}
              >
                {formatNumber(r.quantity)}
              </span>
              <span className="text-right font-mono text-xs text-status-warning">
                {r.reserved > 0 ? formatNumber(r.reserved) : "—"}
              </span>
              <span
                className={`text-right font-mono ${
                  r.available === 0
                    ? "text-muted-foreground"
                    : "text-status-success"
                }`}
              >
                {formatNumber(r.available)}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {formatDate(r.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
