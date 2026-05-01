"use client";

/**
 * Quản lý bảng giá — Settings overview.
 *
 * Sprint CD-1 fix: trước đây toàn bộ là MOCK (`mockPriceBooks` 3 dòng
 * hardcoded "Giá bán lẻ/sỉ/đại lý" với productCount: 156 bịa, button
 * "Lưu cài đặt" không gọi gì). CEO mở thấy 3 bảng giá ảo → tin có rồi
 * → thực tế DB có thể trống hoàn toàn.
 *
 * Fix: load `getPriceTiers()` thật từ DB. CRUD đầy đủ ở
 * `/hang-hoa/thiet-lap-gia` — page này chỉ là overview + entry point.
 *
 * Quy tắc áp dụng (priceRule): hiện engine `pricing.ts` chọn tier theo
 * thứ tự: customer.priceTierId → branch.priceTierId → niêm yết. Đây là
 * hard-coded behavior, không phải tenant config — bỏ section radio
 * (trước đây local state vô nghĩa).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { getPriceTiers } from "@/lib/services";
import type { PriceTier } from "@/lib/types";

const SCOPE_LABELS: Record<string, string> = {
  retail: "POS Retail",
  fnb: "POS FnB",
  both: "Cả 2 kênh",
};

export default function PriceBookSettingsPage() {
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getPriceTiers({})
      .then((list) => {
        if (!cancelled) setTiers(list);
      })
      .catch(() => {
        if (!cancelled) setTiers([]);
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
          <h1 className="text-2xl font-bold">Quản lý bảng giá</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tổng quan các bảng giá B2B đang áp dụng. Tạo / sửa chi tiết bảng
            giá tại{" "}
            <Link
              href="/hang-hoa/thiet-lap-gia"
              className="text-primary font-medium hover:underline"
            >
              Hàng hóa → Thiết lập giá
            </Link>
            .
          </p>
        </div>
        <Link
          href="/hang-hoa/thiet-lap-gia"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Icon name="add" size={16} />
          Thêm bảng giá
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bảng giá hiện có ({tiers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Icon
                name="progress_activity"
                size={16}
                className="animate-spin mr-2"
              />
              Đang tải bảng giá...
            </div>
          ) : tiers.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Icon
                name="price_change"
                size={32}
                className="mx-auto mb-2 opacity-30"
              />
              <p>Chưa có bảng giá nào.</p>
              <p className="text-xs mt-1">
                Mọi sản phẩm đang dùng giá niêm yết. Tạo bảng giá để áp dụng
                ưu đãi B2B cho khách sỉ / đại lý.
              </p>
              <Link
                href="/hang-hoa/thiet-lap-gia"
                className="inline-flex items-center mt-4 px-3 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors"
              >
                Tạo bảng giá đầu tiên
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {tiers.map((tier) => (
                <div
                  key={tier.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{tier.name}</span>
                      {tier.code && (
                        <span className="text-xs font-mono text-muted-foreground">
                          ({tier.code})
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          tier.isActive
                            ? "bg-status-success/10 text-status-success border-status-success/25"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {tier.isActive ? "Đang áp dụng" : "Tạm ngưng"}
                      </Badge>
                      {tier.scope && (
                        <Badge
                          variant="outline"
                          className="text-xs bg-primary-fixed text-primary border-primary/25"
                        >
                          {SCOPE_LABELS[tier.scope] ?? tier.scope}
                        </Badge>
                      )}
                    </div>
                    {tier.description && (
                      <div className="text-xs text-muted-foreground">
                        {tier.description}
                      </div>
                    )}
                  </div>
                  <Link
                    href={`/hang-hoa/thiet-lap-gia?tier=${tier.id}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors"
                  >
                    <Icon name="edit" size={14} />
                    Chỉnh sửa
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quy tắc áp dụng</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary-fixed text-primary text-xs font-bold shrink-0 mt-0.5">
                1
              </span>
              <div>
                <p className="font-medium">Bảng giá riêng của khách hàng</p>
                <p className="text-xs text-muted-foreground">
                  Mỗi khách hàng có thể được gắn bảng giá B2B mặc định khi tạo.
                  POS sẽ ưu tiên bảng giá này cho khách đó.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary-fixed text-primary text-xs font-bold shrink-0 mt-0.5">
                2
              </span>
              <div>
                <p className="font-medium">Bảng giá mặc định của chi nhánh</p>
                <p className="text-xs text-muted-foreground">
                  Nếu khách không có bảng giá riêng, hệ thống dùng bảng giá đã
                  gán cho chi nhánh hiện tại (cấu hình ở{" "}
                  <Link
                    href="/cai-dat/chi-nhanh"
                    className="text-primary hover:underline"
                  >
                    Chi nhánh
                  </Link>
                  ).
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary-fixed text-primary text-xs font-bold shrink-0 mt-0.5">
                3
              </span>
              <div>
                <p className="font-medium">Giá niêm yết</p>
                <p className="text-xs text-muted-foreground">
                  Sản phẩm không có trong bảng giá nào → tự động dùng giá niêm
                  yết (cột Giá bán ở Hàng hóa).
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
