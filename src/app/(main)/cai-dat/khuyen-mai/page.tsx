"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
}: {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}

interface Promotion {
  id: string;
  name: string;
  code: string;
  type: "percent" | "fixed" | "freeship";
  value: number;
  minOrder: number;
  startDate: string;
  endDate: string;
  status: "active" | "expired";
}

const mockPromotions: Promotion[] = [
  {
    id: "1",
    name: "Giảm 10% đơn trên 500K",
    code: "GIAM10",
    type: "percent",
    value: 10,
    minOrder: 500000,
    startDate: "01/01/2026",
    endDate: "31/03/2026",
    status: "active",
  },
  {
    id: "2",
    name: "Giảm 20K đơn trên 100K",
    code: "GIAM20K",
    type: "fixed",
    value: 20000,
    minOrder: 100000,
    startDate: "01/02/2026",
    endDate: "30/06/2026",
    status: "active",
  },
  {
    id: "3",
    name: "Freeship đơn trên 200K",
    code: "FREESHIP",
    type: "freeship",
    value: 0,
    minOrder: 200000,
    startDate: "01/01/2026",
    endDate: "28/02/2026",
    status: "expired",
  },
];

function getTypeIcon(type: Promotion["type"]) {
  switch (type) {
    case "percent":
      return <Icon name="percent" size={16} />;
    case "fixed":
      return <Icon name="sell" size={16} />;
    case "freeship":
      return <Icon name="local_shipping" size={16} />;
  }
}

function getTypeLabel(type: Promotion["type"], value: number) {
  switch (type) {
    case "percent":
      return `Giảm ${value}%`;
    case "fixed":
      return `Giảm ${formatCurrency(value)}`;
    case "freeship":
      return "Miễn phí vận chuyển";
  }
}

export default function PromotionSettingsPage() {
  const [enablePromotions, setEnablePromotions] = useState(true);
  const [autoApplyBest, setAutoApplyBest] = useState(true);
  const [allowMultipleCodes, setAllowMultipleCodes] = useState(false);
  const [showOnInvoice, setShowOnInvoice] = useState(true);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt khuyến mãi</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Quản lý chương trình khuyến mãi và mã giảm giá
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Chương trình khuyến mãi</CardTitle>
            <Toggle
              checked={enablePromotions}
              onCheckedChange={setEnablePromotions}
              label=""
            />
          </div>
        </CardHeader>
        <CardContent>
          {enablePromotions ? (
            <div className="space-y-4">
              {mockPromotions.map((promo) => (
                <div
                  key={promo.id}
                  className="flex items-start justify-between rounded-lg border p-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {promo.name}
                      </span>
                      <Badge
                        variant={
                          promo.status === "active" ? "default" : "secondary"
                        }
                        className={cn(
                          "text-xs",
                          promo.status === "active"
                            ? "bg-green-100 text-green-700 hover:bg-green-100"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-100"
                        )}
                      >
                        {promo.status === "active" ? "Đang hoạt động" : "Hết hạn"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono font-medium">
                        {promo.code}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        {getTypeIcon(promo.type)}
                        {getTypeLabel(promo.type, promo.value)}
                      </span>
                      <span>
                        Đơn tối thiểu: {formatCurrency(promo.minOrder)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {promo.startDate} — {promo.endDate}
                    </div>
                  </div>
                </div>
              ))}

              <Button variant="outline" className="w-full">
                <Icon name="add" size={16} className="mr-1.5" />
                Thêm chương trình
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Khuyến mãi đã được tắt. Bật lại để quản lý chương trình.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cài đặt chung</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <Toggle
              checked={autoApplyBest}
              onCheckedChange={setAutoApplyBest}
              label="Tự động áp dụng KM tốt nhất"
              description="Hệ thống tự chọn khuyến mãi có lợi nhất cho khách hàng"
            />
            <Toggle
              checked={allowMultipleCodes}
              onCheckedChange={setAllowMultipleCodes}
              label="Cho phép dùng nhiều mã cùng lúc"
              description="Khách hàng có thể nhập nhiều mã khuyến mãi trong một đơn hàng"
            />
            <Toggle
              checked={showOnInvoice}
              onCheckedChange={setShowOnInvoice}
              label="Hiển thị KM trên hóa đơn"
              description="In thông tin khuyến mãi đã áp dụng trên hóa đơn"
            />
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button>
          <Icon name="save" size={16} className="mr-1.5" />
          Lưu cài đặt
        </Button>
      </div>
    </div>
  );
}
