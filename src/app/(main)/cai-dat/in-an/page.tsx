"use client";

import { useSettings } from "@/lib/contexts/settings-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Usb,
  Wifi,
  Network
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";

// ── Toggle component ──
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
      <div>
        <span className="text-sm font-medium">{label}</span>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
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

// ── Paper size templates ──
const templates = [
  { id: "58mm" as const, label: "58mm", desc: "Máy in bill nhỏ" },
  { id: "80mm" as const, label: "80mm", desc: "Máy in bill tiêu chuẩn" },
  { id: "A4" as const, label: "A4", desc: "In giấy A4" },
  { id: "A5" as const, label: "A5", desc: "In giấy A5" },
];

// ── Connection types ──
const connectionTypes = [
  { id: "usb" as const, label: "USB / Cáp", icon: Usb, desc: "Kết nối trực tiếp qua cáp USB" },
  { id: "wifi" as const, label: "WiFi", icon: Wifi, desc: "Kết nối qua mạng WiFi" },
  { id: "lan" as const, label: "LAN", icon: Network, desc: "Kết nối qua cáp mạng LAN" },
];

// ── Kitchen ticket styles ──
const kitchenStyles = [
  { id: "compact" as const, label: "Gọn", desc: "Chỉ tên món + số lượng" },
  { id: "standard" as const, label: "Tiêu chuẩn", desc: "Tên + topping + ghi chú" },
  { id: "detailed" as const, label: "Chi tiết", desc: "Đầy đủ + giá + variant" },
];

// ── Receipt styles ──
const receiptStyles = [
  { id: "minimal" as const, label: "Tối giản", desc: "Chỉ tổng tiền + thanh toán" },
  { id: "standard" as const, label: "Tiêu chuẩn", desc: "Món + giá + thanh toán" },
  { id: "full" as const, label: "Đầy đủ", desc: "Đầy đủ + topping + giảm giá + QR" },
];

export default function PrintSettingsPage() {
  const { settings, updateSettings } = useSettings();
  const print = settings.print;
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");

  const update = (values: Partial<typeof print>) => {
    updateSettings("print", values);
  };

  const handleTestPrint = () => {
    setTestStatus("testing");
    try {
      const width = print.paperSize === "58mm" ? 220 : 302;
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Test Print</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;font-size:14px;width:${width}px;margin:0 auto;padding:12px;text-align:center}
.line{border-top:2px dashed #000;margin:10px 0}
h2{font-size:18px;margin:8px 0}
.info{font-size:12px;color:#555}
@media print{body{width:${width}px}@page{size:${print.paperSize === "58mm" ? "58mm" : "80mm"} auto;margin:0}}
</style></head><body>
<h2>TEST IN</h2>
<div class="line"></div>
<p>Kết nối: ${connectionTypes.find(c => c.id === print.connectionType)?.label}</p>
<p>Khổ giấy: ${print.paperSize}</p>
${print.connectionType !== "usb" ? `<p>IP: ${print.printerIp || "(chưa cấu hình)"}:${print.printerPort}</p>` : ""}
<div class="line"></div>
<p class="info">Nếu bạn thấy phiếu này → máy in hoạt động!</p>
<p class="info">${new Date().toLocaleString("vi-VN")}</p>
</body></html>`;

      const win = window.open("", "_blank", "width=400,height=500");
      if (!win) {
        setTestStatus("error");
        return;
      }
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
      setTimeout(() => win.close(), 2000);
      setTestStatus("success");
      setTimeout(() => setTestStatus("idle"), 3000);
    } catch {
      setTestStatus("error");
      setTimeout(() => setTestStatus("idle"), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt in ấn</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Cấu hình máy in, khổ giấy và mẫu in cho POS & F&B
        </p>
      </div>

      {/* ── 1. Printer Connection ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="print" />
            Kết nối máy in
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Connection type tabs */}
          <div className="grid gap-3 sm:grid-cols-3">
            {connectionTypes.map((ct) => {
              const Icon = ct.icon;
              return (
                <button
                  key={ct.id}
                  type="button"
                  onClick={() => update({ connectionType: ct.id })}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                    print.connectionType === ct.id
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <Icon className={cn(
                    "h-6 w-6",
                    print.connectionType === ct.id ? "text-primary" : "text-muted-foreground"
                  )} />
                  <span className="text-sm font-medium">{ct.label}</span>
                  <span className="text-xs text-muted-foreground text-center">{ct.desc}</span>
                </button>
              );
            })}
          </div>

          {/* Connection details based on type */}
          {print.connectionType === "usb" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Tên máy in (tuỳ chọn)</label>
              <Input
                value={print.printerName}
                onChange={(e) => update({ printerName: e.target.value })}
                placeholder="VD: EPSON TM-T82, Xprinter XP-58..."
              />
              <p className="text-xs text-muted-foreground">
                Máy in sẽ được chọn qua hộp thoại hệ thống khi in.
              </p>
            </div>
          )}

          {(print.connectionType === "wifi" || print.connectionType === "lan") && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Địa chỉ IP máy in</label>
                <Input
                  value={print.printerIp}
                  onChange={(e) => update({ printerIp: e.target.value })}
                  placeholder="VD: 192.168.1.100"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Cổng (Port)</label>
                <Input
                  type="number"
                  value={print.printerPort}
                  onChange={(e) => update({ printerPort: parseInt(e.target.value) || 9100 })}
                  placeholder="9100"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Tên máy in (tuỳ chọn)</label>
                <Input
                  value={print.printerName}
                  onChange={(e) => update({ printerName: e.target.value })}
                  placeholder="VD: EPSON TM-T82, Star TSP143..."
                />
              </div>
            </div>
          )}

          {/* Test print */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="outline"
              onClick={handleTestPrint}
              disabled={testStatus === "testing"}
            >
              <Icon name="print" size={16} className="mr-1.5" />
              {testStatus === "testing" ? "Đang in..." : "In thử"}
            </Button>
            {testStatus === "success" && (
              <span className="flex items-center gap-1 text-sm text-status-success">
                <Icon name="check_circle" size={16} /> Đã gửi lệnh in
              </span>
            )}
            {testStatus === "error" && (
              <span className="text-sm text-status-error">Lỗi — kiểm tra popup blocker</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── 2. Paper Size ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="description" />
            Khổ giấy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => update({ paperSize: tpl.id })}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-3 transition-colors",
                  print.paperSize === tpl.id
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <span className="text-lg font-bold">{tpl.label}</span>
                <span className="text-xs text-muted-foreground">{tpl.desc}</span>
              </button>
            ))}
          </div>

          <Separator className="my-4" />

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Số bản in</h4>
            <Select
              value={String(print.copies)}
              onValueChange={(v) => v && update({ copies: parseInt(v) })}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} bản</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── 3. Receipt Content ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="receipt" />
            Nội dung phiếu in
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <Toggle
              checked={print.showStoreName}
              onCheckedChange={(v) => update({ showStoreName: v })}
              label="Tên cửa hàng"
            />
            <Toggle
              checked={print.showStoreAddress}
              onCheckedChange={(v) => update({ showStoreAddress: v })}
              label="Địa chỉ"
            />
            <Toggle
              checked={print.showStorePhone}
              onCheckedChange={(v) => update({ showStorePhone: v })}
              label="Số điện thoại"
            />
            <Toggle
              checked={print.showBarcode}
              onCheckedChange={(v) => update({ showBarcode: v })}
              label="Mã vạch"
            />
            <Toggle
              checked={print.showQr}
              onCheckedChange={(v) => update({ showQr: v })}
              label="Mã QR thanh toán"
              description="Hiện QR chuyển khoản trên phiếu"
            />
          </div>

          <Separator className="my-4" />

          <div className="space-y-2">
            <label className="text-sm font-medium">Chân phiếu (footer)</label>
            <Input
              value={print.receiptFooter}
              onChange={(e) => update({ receiptFooter: e.target.value })}
              placeholder="VD: Cảm ơn quý khách!"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── 4. FnB Print Styles ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="restaurant" />
            Cài đặt in F&B
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Auto-print toggles */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Tự động in</h4>
            <div className="divide-y">
              <Toggle
                checked={print.autoPrintKitchen}
                onCheckedChange={(v) => update({ autoPrintKitchen: v })}
                label="Phiếu bếp/bar"
                description="Tự động in phiếu khi gửi bếp"
              />
              <Toggle
                checked={print.autoPrintPreBill}
                onCheckedChange={(v) => update({ autoPrintPreBill: v })}
                label="Phiếu tạm tính"
                description="In phiếu tạm khi khách yêu cầu tính tiền"
              />
              <Toggle
                checked={print.autoPrintReceipt}
                onCheckedChange={(v) => update({ autoPrintReceipt: v })}
                label="Phiếu thanh toán"
                description="Tự động in hoá đơn sau khi thanh toán"
              />
            </div>
          </div>

          <Separator />

          {/* Kitchen ticket style */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Kiểu phiếu bếp/bar</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              {kitchenStyles.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => update({ kitchenTicketStyle: style.id })}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                    print.kitchenTicketStyle === style.id
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <span className="text-sm font-medium">{style.label}</span>
                  <span className="text-xs text-muted-foreground">{style.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Receipt style */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Kiểu phiếu thanh toán</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              {receiptStyles.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => update({ receiptStyle: style.id })}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                    print.receiptStyle === style.id
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <span className="text-sm font-medium">{style.label}</span>
                  <span className="text-xs text-muted-foreground">{style.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
