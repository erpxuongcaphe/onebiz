"use client";

/**
 * Trang "Toàn vẹn kho" — CEO 13/05/2026.
 *
 * Mục đích: owner chạy on-demand reconciliation check để phát hiện drift
 * giữa 3 lớp lưu tồn (products.stock / branch_stock / product_lots).
 *
 * Nếu phát hiện drift → owner biết SP/chi nhánh nào lệch, từ đó quyết
 * định cách fix (kiểm kê thủ công / điều chỉnh lot / contact em).
 *
 * Permission: chỉ owner hoặc có quyền 'system.manage_settings'.
 */

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts/toast-context";
import {
  verifyStockInvariants,
  type StockInvariantsResult,
} from "@/lib/services";
import { formatNumber, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PermissionPage } from "@/components/shared/permission-page";
import { PERMISSIONS } from "@/lib/permissions";

// S-2 13/06/2026 audit lần 2: guard — permission khớp nav-config (view_audit).
export default function StockIntegrityPageGuarded() {
  return (
    <PermissionPage requires={PERMISSIONS.SYSTEM_VIEW_AUDIT}>
      <StockIntegrityPage />
    </PermissionPage>
  );
}

function StockIntegrityPage() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<StockInvariantsResult | null>(null);

  const handleCheck = async () => {
    setRunning(true);
    try {
      const r = await verifyStockInvariants(0.01);
      setResult(r);
      if (r.allOk) {
        toast({
          title: "✅ Kho toàn vẹn",
          description: "Không phát hiện drift ở 3 lớp lưu tồn.",
          variant: "success",
          duration: 5000,
        });
      } else {
        const total =
          r.invariant1.violationsCount +
          r.invariant2.violationsCount +
          r.invariant3.violationsCount;
        toast({
          title: `⚠️ Phát hiện ${total} drift`,
          description: "Xem chi tiết bên dưới — có thể cần kiểm kê / điều chỉnh.",
          variant: "warning",
          duration: 6000,
        });
      }
    } catch (err) {
      toast({
        title: "Lỗi khi check",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
        duration: 8000,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Toàn vẹn kho</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Reconciliation check giữa 3 lớp lưu tồn — phát hiện sớm drift nếu có
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="rule" />3 Invariant cần đảm bảo
          </CardTitle>
          <CardDescription>
            Hệ thống lưu tồn ở 3 lớp. Mỗi lần nhập/xuất phải update đồng bộ —
            nếu lệch nhau gọi là &quot;drift&quot;, cần phát hiện sớm.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <span className="rounded bg-primary/10 text-primary px-2 py-0.5 text-xs font-bold shrink-0">
              #1
            </span>
            <div>
              <strong>products.stock = SUM(branch_stock)</strong> — tổng tồn
              công ty phải bằng tổng các chi nhánh cộng lại.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="rounded bg-primary/10 text-primary px-2 py-0.5 text-xs font-bold shrink-0">
              #2
            </span>
            <div>
              <strong>branch_stock = SUM(stock_movements: in − out)</strong> —
              tồn chi nhánh phải bằng audit log cộng/trừ từ trước tới giờ.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="rounded bg-primary/10 text-primary px-2 py-0.5 text-xs font-bold shrink-0">
              #3
            </span>
            <div>
              <strong>branch_stock ≈ SUM(product_lots)</strong> — với SP có lot
              tracking (NVL), tổng số lượng các lô bằng tồn chi nhánh.
            </div>
          </div>

          <div className="pt-3">
            <Button onClick={handleCheck} disabled={running}>
              {running ? (
                <>
                  <Icon
                    name="progress_activity"
                    size={16}
                    className="mr-1 animate-spin"
                  />
                  Đang check...
                </>
              ) : (
                <>
                  <Icon name="rule" size={16} className="mr-1" />
                  Chạy check ngay
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <>
          {/* Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon
                  name={result.allOk ? "check_circle" : "warning"}
                  className={
                    result.allOk ? "text-status-success" : "text-status-warning"
                  }
                />
                {result.allOk ? "Kho toàn vẹn ✅" : "Phát hiện drift ⚠️"}
              </CardTitle>
              <CardDescription>
                Check vào lúc {formatDate(result.verifiedAt)}{" "}
                — tolerance {result.tolerance}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { idx: 1, count: result.invariant1.violationsCount, label: "Tổng vs chi nhánh" },
                  { idx: 2, count: result.invariant2.violationsCount, label: "Chi nhánh vs audit log" },
                  { idx: 3, count: result.invariant3.violationsCount, label: "Chi nhánh vs lô FIFO" },
                ].map((s) => (
                  <div
                    key={s.idx}
                    className={cn(
                      "rounded-lg border p-3",
                      s.count === 0
                        ? "border-status-success/30 bg-status-success/5"
                        : "border-status-warning/40 bg-status-warning/5",
                    )}
                  >
                    <div className="text-xs text-muted-foreground">
                      Invariant #{s.idx}
                    </div>
                    <div
                      className={cn(
                        "text-2xl font-bold tabular-nums",
                        s.count === 0
                          ? "text-status-success"
                          : "text-status-warning",
                      )}
                    >
                      {s.count}
                    </div>
                    <div className="text-xs">{s.label}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Invariant 1 violations */}
          {result.invariant1.violationsCount > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Invariant #1: products.stock ≠ SUM(branch_stock)
                </CardTitle>
                <CardDescription>
                  {result.invariant1.violationsCount} sản phẩm bị lệch
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container-low">
                      <tr className="text-left">
                        <th className="p-2">Mã SP</th>
                        <th className="p-2">Tên SP</th>
                        <th className="p-2 text-right">products.stock</th>
                        <th className="p-2 text-right">SUM(branch_stock)</th>
                        <th className="p-2 text-right">Drift</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.invariant1.violations.map((v) => (
                        <tr key={v.productId} className="border-b">
                          <td className="p-2 font-mono text-xs">{v.code}</td>
                          <td className="p-2">{v.name}</td>
                          <td className="p-2 text-right tabular-nums">
                            {formatNumber(v.productStock)}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {formatNumber(v.branchStockSum)}
                          </td>
                          <td
                            className={cn(
                              "p-2 text-right tabular-nums font-bold",
                              v.drift > 0
                                ? "text-status-warning"
                                : "text-status-error",
                            )}
                          >
                            {v.drift > 0 ? "+" : ""}
                            {formatNumber(v.drift)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Invariant 2 violations */}
          {result.invariant2.violationsCount > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Invariant #2: branch_stock ≠ SUM(stock_movements)
                </CardTitle>
                <CardDescription>
                  {result.invariant2.violationsCount} dòng lệch giữa tồn chi
                  nhánh và audit log
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container-low">
                      <tr className="text-left">
                        <th className="p-2">Chi nhánh</th>
                        <th className="p-2">Mã SP</th>
                        <th className="p-2">Tên</th>
                        <th className="p-2 text-right">Tồn CN</th>
                        <th className="p-2 text-right">Audit log</th>
                        <th className="p-2 text-right">Drift</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.invariant2.violations.map((v, i) => (
                        <tr key={i} className="border-b">
                          <td className="p-2">{v.branchName}</td>
                          <td className="p-2 font-mono text-xs">
                            {v.productCode}
                          </td>
                          <td className="p-2">{v.productName}</td>
                          <td className="p-2 text-right tabular-nums">
                            {formatNumber(v.branchStockQty)}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {formatNumber(v.movementSum ?? 0)}
                          </td>
                          <td
                            className={cn(
                              "p-2 text-right tabular-nums font-bold",
                              v.drift > 0
                                ? "text-status-warning"
                                : "text-status-error",
                            )}
                          >
                            {v.drift > 0 ? "+" : ""}
                            {formatNumber(v.drift)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Invariant 3 violations */}
          {result.invariant3.violationsCount > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Invariant #3: branch_stock ≉ SUM(product_lots)
                </CardTitle>
                <CardDescription>
                  {result.invariant3.violationsCount} SP có tồn lệch với tổng lô
                  FIFO (chỉ check SP có lot active)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container-low">
                      <tr className="text-left">
                        <th className="p-2">Chi nhánh</th>
                        <th className="p-2">Mã SP</th>
                        <th className="p-2">Tên</th>
                        <th className="p-2 text-right">Tồn CN</th>
                        <th className="p-2 text-right">SUM(lots)</th>
                        <th className="p-2 text-right">Drift</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.invariant3.violations.map((v, i) => (
                        <tr key={i} className="border-b">
                          <td className="p-2">{v.branchName}</td>
                          <td className="p-2 font-mono text-xs">
                            {v.productCode}
                          </td>
                          <td className="p-2">{v.productName}</td>
                          <td className="p-2 text-right tabular-nums">
                            {formatNumber(v.branchStockQty)}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {formatNumber(v.lotSum ?? 0)}
                          </td>
                          <td
                            className={cn(
                              "p-2 text-right tabular-nums font-bold",
                              v.drift > 0
                                ? "text-status-warning"
                                : "text-status-error",
                            )}
                          >
                            {v.drift > 0 ? "+" : ""}
                            {formatNumber(v.drift)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
