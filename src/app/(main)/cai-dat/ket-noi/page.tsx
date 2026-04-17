"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
  connected: boolean;
}

const integrations: Integration[] = [
  {
    id: "facebook",
    name: "Facebook",
    description: "Kết nối fanpage để bán hàng",
    icon: <Icon name="public" className="text-primary" />,
    iconBg: "bg-primary-fixed",
    connected: true,
  },
  {
    id: "zalo",
    name: "Zalo OA",
    description: "Kết nối Zalo Official Account",
    icon: <Icon name="chat_bubble" className="text-primary" />,
    iconBg: "bg-primary-fixed",
    connected: true,
  },
  {
    id: "ghn",
    name: "GHN",
    description: "Giao Hàng Nhanh",
    icon: <Icon name="local_shipping" className="text-orange-600" />,
    iconBg: "bg-orange-100",
    connected: true,
  },
  {
    id: "ghtk",
    name: "GHTK",
    description: "Giao Hàng Tiết Kiệm",
    icon: <Icon name="local_shipping" className="text-green-600" />,
    iconBg: "bg-green-100",
    connected: false,
  },
  {
    id: "vnpay",
    name: "VNPay",
    description: "Cổng thanh toán VNPay",
    icon: <Icon name="credit_card" className="text-red-600" />,
    iconBg: "bg-red-100",
    connected: false,
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Đồng bộ dữ liệu",
    icon: <Icon name="table_view" className="text-green-600" />,
    iconBg: "bg-green-100",
    connected: false,
  },
];

export default function IntegrationSettingsPage() {
  const [connectionStates, setConnectionStates] = useState<
    Record<string, boolean>
  >(
    Object.fromEntries(integrations.map((i) => [i.id, i.connected]))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Kết nối & Tích hợp</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Quản lý kết nối với các dịch vụ bên ngoài
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {integrations.map((integration) => {
          const isConnected = connectionStates[integration.id];
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
                          variant={isConnected ? "default" : "secondary"}
                          className={cn(
                            "text-xs",
                            isConnected
                              ? "bg-green-100 text-green-700 hover:bg-green-100"
                              : "bg-gray-100 text-gray-500 hover:bg-gray-100"
                          )}
                        >
                          {isConnected ? "Đã kết nối" : "Chưa kết nối"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {integration.description}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  {isConnected ? (
                    <Button variant="outline" size="sm">
                      Quản lý
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() =>
                        setConnectionStates((prev) => ({
                          ...prev,
                          [integration.id]: true,
                        }))
                      }
                    >
                      Kết nối
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
