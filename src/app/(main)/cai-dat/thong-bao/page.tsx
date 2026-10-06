"use client";

import { SettingsToggle as Toggle } from "@/components/shared/settings-toggle";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useSettings, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";


export default function NotificationSettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { toast } = useToast();

  // Mapped from settings context
  const [newOrder, setNewOrder] = useState(settings.notification.orderNew);
  const [completedOrder, setCompletedOrder] = useState(settings.notification.orderCompleted);
  const [lowStock, setLowStock] = useState(settings.notification.stockLow);
  const [paymentSuccess, setPaymentSuccess] = useState(settings.notification.paymentReceived);
  const [channelEmail, setChannelEmail] = useState(settings.notification.emailNotify);

  // Local-only state (no mapping in settings context yet)
  const [cancelledOrder, setCancelledOrder] = useState(true);
  const [outOfStock, setOutOfStock] = useState(true);
  const [newImport, setNewImport] = useState(false);
  const [overdueDebt, setOverdueDebt] = useState(true);
  const [channelSms, setChannelSms] = useState(false);
  const [channelPush, setChannelPush] = useState(true);

  function handleSave() {
    updateSettings("notification", {
      orderNew: newOrder,
      orderCompleted: completedOrder,
      stockLow: lowStock,
      paymentReceived: paymentSuccess,
      emailNotify: channelEmail,
    });
    toast({
      title: "Đã lưu",
      description: "Cài đặt thông báo đã được cập nhật thành công.",
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt thông báo</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Quản lý các loại thông báo và kênh nhận thông báo
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Thông báo đơn hàng</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <Toggle
              checked={newOrder}
              onCheckedChange={setNewOrder}
              label="Đơn mới"
              description="Thông báo khi có đơn hàng mới"
            />
            <Toggle
              checked={completedOrder}
              onCheckedChange={setCompletedOrder}
              label="Đơn hoàn thành"
              description="Thông báo khi đơn hàng hoàn thành"
            />
            <Toggle
              checked={cancelledOrder}
              onCheckedChange={setCancelledOrder}
              label="Đơn bị hủy"
              description="Thông báo khi đơn hàng bị hủy"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Thông báo kho</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <Toggle
              checked={outOfStock}
              onCheckedChange={setOutOfStock}
              label="Hết hàng"
              description="Thông báo khi sản phẩm hết hàng"
            />
            <Toggle
              checked={lowStock}
              onCheckedChange={setLowStock}
              label="Sắp hết hàng"
              description="Thông báo khi tồn kho dưới mức tối thiểu"
            />
            <Toggle
              checked={newImport}
              onCheckedChange={setNewImport}
              label="Nhập hàng mới"
              description="Thông báo khi có đơn nhập hàng mới"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Thông báo tài chính</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <Toggle
              checked={paymentSuccess}
              onCheckedChange={setPaymentSuccess}
              label="Thanh toán thành công"
              description="Thông báo khi nhận được thanh toán"
            />
            <Toggle
              checked={overdueDebt}
              onCheckedChange={setOverdueDebt}
              label="Công nợ quá hạn"
              description="Thông báo khi có công nợ quá hạn thanh toán"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kênh thông báo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              {
                label: "Email",
                description: "Nhận thông báo qua email",
                checked: channelEmail,
                onChange: setChannelEmail,
              },
              {
                label: "SMS",
                description: "Nhận thông báo qua tin nhắn SMS",
                checked: channelSms,
                onChange: setChannelSms,
              },
              {
                label: "Push notification",
                description: "Nhận thông báo đẩy trên trình duyệt",
                checked: channelPush,
                onChange: setChannelPush,
              },
            ].map((channel) => (
              <label
                key={channel.label}
                className="flex items-start gap-3 cursor-pointer"
              >
                <Checkbox
                  checked={channel.checked}
                  onCheckedChange={(val) => channel.onChange(val === true)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium">{channel.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {channel.description}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button onClick={handleSave}>
          <Icon name="save" size={16} className="mr-1" />
          Lưu thay đổi
        </Button>
      </div>
    </div>
  );
}
