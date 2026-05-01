"use client";

/**
 * Cài đặt giao hàng — Settings overview.
 *
 * Sprint CD-1: trước đây toàn page MOCK — `deliveryZones` (Nội/Ngoại/
 * Liên tỉnh phí 15k/30k/50k) hardcoded, `partners` GHN/GHTK status
 * "connected" giả, button "Lưu" không gọi gì.
 *
 * Fix: load `getDeliveryPartners()` thật từ DB. Delivery zones (phí
 * giao theo khu vực) chưa có schema — gắn nhãn "Đang phát triển".
 *
 * Đối tác giao hàng có CRUD đầy đủ ở `/don-hang/doi-tac-giao-hang`.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { getDeliveryPartners } from "@/lib/services";
import type { DeliveryPartner } from "@/lib/types";

export default function DeliverySettingsPage() {
  const [partners, setPartners] = useState<DeliveryPartner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getDeliveryPartners({ page: 0, pageSize: 50 })
      .then((res) => {
        if (!cancelled) setPartners(res.data);
      })
      .catch(() => {
        if (!cancelled) setPartners([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Cài đặt giao hàng</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Quản lý đối tác vận chuyển và phí giao hàng
          </p>
        </div>
        <Link
          href="/don-hang/doi-tac-giao-hang"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Icon name="add" size={16} />
          Quản lý đối tác
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="local_shipping" size={18} className="text-primary" />
            Đối tác giao hàng ({partners.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
              <Icon
                name="progress_activity"
                size={16}
                className="animate-spin mr-2"
              />
              Đang tải...
            </div>
          ) : partners.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              <Icon
                name="local_shipping"
                size={32}
                className="mx-auto mb-2 opacity-30"
              />
              <p>Chưa có đối tác giao hàng nào.</p>
              <Link
                href="/don-hang/doi-tac-giao-hang"
                className="inline-flex items-center mt-4 px-3 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors"
              >
                Thêm đối tác đầu tiên
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {partners.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary-fixed text-primary text-xs font-bold">
                      {p.name?.slice(0, 3).toUpperCase() || "DV"}
                    </span>
                    <div>
                      <div className="text-sm font-medium">{p.name}</div>
                      {p.phone && (
                        <div className="text-xs text-muted-foreground">{p.phone}</div>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      p.status === "active"
                        ? "bg-status-success/10 text-status-success border-status-success/25"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {p.statusName || (p.status === "active" ? "Đang dùng" : "Tạm ngưng")}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="map" size={18} className="text-status-warning" />
            Phí giao hàng theo khu vực
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 p-3 rounded-md bg-status-warning/5 border border-status-warning/20">
            <Icon
              name="info"
              size={16}
              className="text-status-warning mt-0.5 shrink-0"
            />
            <div className="text-xs">
              <p className="font-medium text-foreground">Đang phát triển</p>
              <p className="text-muted-foreground mt-1">
                Tính năng cấu hình phí giao theo khu vực (nội thành / ngoại
                thành / liên tỉnh) đang được phát triển. Hiện phí giao được
                nhập thủ công khi tạo vận đơn ở /don-hang/van-don.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
