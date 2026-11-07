"use client";

import { SettingsToggle as Toggle } from "@/components/shared/settings-toggle";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useSettings, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { useUnsavedSnapshot } from "@/lib/hooks/use-unsaved-work";

function UnavailableSetting({ label }: { label: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
    <span>{label}</span>
    <span className="text-xs text-muted-foreground">Chưa hỗ trợ cài đặt</span>
  </div>;
}

export default function NotificationSettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { toast } = useToast();

  const [draft, setDraft] = useState<Partial<typeof settings.notification>>({});
  const editSnapshot = { ...settings.notification, ...draft };
  const edit = (key: keyof typeof settings.notification, checked: boolean) =>
    setDraft(previous => ({ ...previous, [key]: checked }));
  const markSaved = useUnsavedSnapshot(draft);
  function handleSave() {
    updateSettings("notification", editSnapshot);
    setDraft({});
    markSaved({});
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
              checked={editSnapshot.orderNew}
              onCheckedChange={checked => edit("orderNew", checked)}
              label="Đơn mới"
              description="Thông báo khi có đơn hàng mới"
            />
            <Toggle
              checked={editSnapshot.orderCompleted}
              onCheckedChange={checked => edit("orderCompleted", checked)}
              label="Đơn hoàn thành"
              description="Thông báo khi đơn hàng hoàn thành"
            />
            <UnavailableSetting label="Đơn bị hủy" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Thông báo kho</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <UnavailableSetting label="Hết hàng" />
            <Toggle
              checked={editSnapshot.stockLow}
              onCheckedChange={checked => edit("stockLow", checked)}
              label="Sắp hết hàng"
              description="Thông báo khi tồn kho dưới mức tối thiểu"
            />
            <UnavailableSetting label="Nhập hàng mới" />
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
              checked={editSnapshot.paymentReceived}
              onCheckedChange={checked => edit("paymentReceived", checked)}
              label="Thanh toán thành công"
              description="Thông báo khi nhận được thanh toán"
            />
            <UnavailableSetting label="Công nợ quá hạn" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kênh thông báo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
              <label
                className="flex items-start gap-3 cursor-pointer"
              >
                <Checkbox
                  checked={editSnapshot.emailNotify}
                  onCheckedChange={val => edit("emailNotify", val === true)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium">Email</div>
                  <div className="text-xs text-muted-foreground">
                    Nhận thông báo qua email
                  </div>
                </div>
              </label>
            <UnavailableSetting label="SMS" />
            <UnavailableSetting label="Thông báo đẩy" />
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
