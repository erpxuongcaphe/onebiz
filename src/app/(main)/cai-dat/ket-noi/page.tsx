"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

// HT-2 fix: trang trước đây hardcode `connected: true/false` cho 6 dịch vụ
// + button "Kết nối" chỉ setState local — KHÔNG OAuth, KHÔNG gọi API thật.
// User lừa nghĩ đã connect → CEO không hiểu sao đơn online không ship được.
// Fix: gắn nhãn trung thực "Sắp ra mắt" cho tất cả, button disabled với
// hint "Liên hệ admin nếu cần ưu tiên integration này".

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
}

const integrations: Integration[] = [
  {
    id: "facebook",
    name: "Facebook",
    description: "Kết nối fanpage để bán hàng",
    icon: <Icon name="public" className="text-primary" />,
    iconBg: "bg-primary-fixed",
  },
  {
    id: "zalo",
    name: "Zalo OA",
    description: "Kết nối Zalo Official Account",
    icon: <Icon name="chat_bubble" className="text-primary" />,
    iconBg: "bg-primary-fixed",
  },
  {
    id: "ghn",
    name: "GHN",
    description: "Giao Hàng Nhanh",
    icon: <Icon name="local_shipping" className="text-status-warning" />,
    iconBg: "bg-status-warning/10",
  },
  {
    id: "ghtk",
    name: "GHTK",
    description: "Giao Hàng Tiết Kiệm",
    icon: <Icon name="local_shipping" className="text-status-success" />,
    iconBg: "bg-status-success/10",
  },
  {
    id: "vnpay",
    name: "VNPay",
    description: "Cổng thanh toán VNPay",
    icon: <Icon name="credit_card" className="text-status-error" />,
    iconBg: "bg-status-error/10",
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Đồng bộ dữ liệu",
    icon: <Icon name="table_view" className="text-status-success" />,
    iconBg: "bg-status-success/10",
  },
];

export default function IntegrationSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Kết nối & Tích hợp</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Quản lý kết nối với các dịch vụ bên ngoài
        </p>
      </div>

      <div className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-4 flex items-start gap-3">
        <Icon name="info" size={18} className="text-status-warning mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-medium text-foreground">Tích hợp đang được phát triển</p>
          <p className="text-xs text-muted-foreground mt-1">
            Các integration dưới đây hiện chưa hoạt động thật (chưa wire OAuth/API).
            Liên hệ team để ưu tiên integration anh cần triển khai trước.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {integrations.map((integration) => {
          return (
            <Card key={integration.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                        integration.iconBg
                      )}
                    >
                      {integration.icon}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          {integration.name}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-xs bg-status-warning/10 text-status-warning border-status-warning/25 hover:bg-status-warning/10"
                        >
                          Sắp ra mắt
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {integration.description}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button size="sm" variant="outline" disabled>
                    Đang phát triển
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
