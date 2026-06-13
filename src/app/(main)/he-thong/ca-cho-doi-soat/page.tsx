"use client";

/**
 * Ca chờ đối chiếu — danh sách quản lý ca pending_reconcile.
 *
 * CEO 06/06/2026 chốt:
 *   - URL: /he-thong/ca-cho-doi-soat
 *   - Permission: shifts.reconcile_any (Owner/Admin) hoặc
 *     shifts.reconcile_own_branch (Manager — chỉ thấy ca của chi nhánh
 *     mình quản lý).
 *   - View: danh sách card responsive (1 col mobile, 2 col tablet, grid laptop)
 *   - Click "Đối chiếu" → mở ReconcileShiftDialog (shared với POS popup).
 *
 * Tránh trùng UI: tái sử dụng ReconcileShiftDialog từ shared component.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/lib/contexts";
import { usePermissions, PERMISSIONS } from "@/lib/permissions";
import { formatCurrency } from "@/lib/format";
import {
  getPendingShifts,
  type PendingShift,
} from "@/lib/services/supabase/shifts";
import { ReconcileShiftDialog } from "@/components/shared/shift/pending-shift-alert";
import { PermissionPage } from "@/components/shared/permission-page";

// S-2 13/06/2026 audit lần 2: guard — permission khớp nav-config (shifts.reconcile_own_branch).
export default function CaChoDoiSoatPageGuarded() {
  return (
    <PermissionPage requires={PERMISSIONS.SHIFTS_RECONCILE_OWN_BRANCH}>
      <CaChoDoiSoatPage />
    </PermissionPage>
  );
}

function CaChoDoiSoatPage() {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const [shifts, setShifts] = useState<PendingShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PendingShift | null>(null);

  // Permission check — chặn truy cập
  const canReconcileAny = hasPermission("shifts.reconcile_any");
  const canReconcileOwn = hasPermission("shifts.reconcile_own_branch");
  const canView = canReconcileAny || canReconcileOwn;

  const fetchData = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Owner/Admin xem all; Manager view chỉ chi nhánh mình (lọc client-side
      // bằng RLS / permission code đã ràng buộc ở DB).
      const rows = await getPendingShifts();
      setShifts(rows);
    } catch (err) {
      toast({
        title: "Lỗi tải ca pending",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [canView, toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (!canView) {
    return (
      <div className="container mx-auto p-4 sm:p-6 max-w-3xl">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Icon name="lock" size={40} className="mx-auto text-muted-foreground" />
            <p className="font-semibold">Bạn không có quyền xem trang này</p>
            <p className="text-sm text-muted-foreground">
              Cần quyền <code className="px-1.5 py-0.5 rounded bg-muted text-xs">
              shifts.reconcile_any</code> hoặc <code className="px-1.5 py-0.5 rounded bg-muted text-xs">
              shifts.reconcile_own_branch</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-4">
      <PageHeader
        title="Ca chờ đối chiếu"
        subtitle={`${shifts.length} ca chưa được đóng đúng hạn — cần đối chiếu để chốt số liệu vào báo cáo.`}
      />

      {/* Hướng dẫn ngắn */}
      <Card className="bg-status-info/5 border-status-info/30">
        <CardContent className="py-3 px-4 flex items-start gap-3 text-sm">
          <Icon name="info" size={18} className="text-status-info mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Ca pending là gì?</p>
            <p className="text-muted-foreground text-xs">
              Khi cashier mở ca và quên đóng quá giờ chốt (mặc định 3h sáng), hệ thống tự
              chuyển ca sang "Chờ đối chiếu". Manager/Admin đếm tiền mặt thực tế + nhập
              lý do để chốt số liệu.{" "}
              <Link href="/he-thong/chi-nhanh" className="text-primary hover:underline">
                Đổi giờ chốt ca per chi nhánh
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Icon name="progress_activity" size={28} className="mx-auto animate-spin mb-2" />
            Đang tải ca pending...
          </CardContent>
        </Card>
      ) : shifts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-2">
            <Icon name="check_circle" size={48} className="mx-auto text-status-success" />
            <p className="font-semibold">Không có ca nào chờ đối chiếu</p>
            <p className="text-sm text-muted-foreground">
              Tất cả ca đã được đóng đúng hạn. 🎉
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shifts.map((s) => (
            <Card
              key={s.id}
              className="border-status-warning/30 hover:border-status-warning hover:shadow-md transition-all"
            >
              <CardContent className="p-4 space-y-3">
                {/* Header cashier */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-status-warning/10 flex items-center justify-center shrink-0">
                    <Icon name="schedule" size={20} className="text-status-warning" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{s.cashierName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {s.branchName}
                    </p>
                  </div>
                </div>

                {/* Thông tin ca */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mở ca:</span>
                    <span className="font-medium">
                      {new Date(s.openedAt).toLocaleString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kéo dài:</span>
                    <span className="font-medium text-status-warning">
                      {Math.round(s.shiftDurationHours)}h
                    </span>
                  </div>
                  {s.startingCash > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Đầu ca:</span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(s.startingCash)}đ
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tự pending:</span>
                    <span className="font-medium text-xs">
                      {new Date(s.autoMarkedPendingAt).toLocaleString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>

                {/* Action */}
                <Button
                  onClick={() => setSelected(s)}
                  className="w-full bg-status-success hover:bg-status-success/90"
                  size="sm"
                >
                  <Icon name="fact_check" size={16} className="mr-1.5" />
                  Đối chiếu ngay
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Reconcile dialog — tái sử dụng từ shared component */}
      {selected && (
        <ReconcileShiftDialog
          shift={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            void fetchData();
            toast({
              title: "Đã đối chiếu xong",
              description: "Ca đã được chốt vào báo cáo.",
              variant: "success",
            });
          }}
        />
      )}
    </div>
  );
}
