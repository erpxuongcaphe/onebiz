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
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  requestPrinter,
  savePrinter,
  loadPrinter,
  clearPrinter,
  isWebUsbSupported,
  testPrint,
  type StoredPrinter,
} from "@/lib/printer";
import { useToast } from "@/lib/contexts/toast-context";

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

// ── Print backends ──
const backends = [
  {
    id: "browser" as const,
    label: "Qua trình duyệt",
    desc: "Tương thích mọi máy in đã cài driver (USB / LAN / WiFi / AirPrint). Sẽ hiện hộp thoại chọn máy in.",
    icon: "print" as const,
  },
  {
    id: "escpos-usb" as const,
    label: "Máy in nhiệt USB (ESC/POS)",
    desc: "In tức thì, không popup. Tự cắt giấy + mở ngăn kéo. Hỗ trợ Xprinter, Epson TM, Sunmi, Gprinter...",
    icon: "bolt" as const,
  },
];

export default function PrintSettingsPage() {
  const { settings, updateSettings } = useSettings();
  const print = settings.print;
  const { toast } = useToast();
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testError, setTestError] = useState<string>("");
  const [storedPrinter, setStoredPrinter] = useState<StoredPrinter | null>(null);
  const [webusbSupported, setWebusbSupported] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const update = (values: Partial<typeof print>) => {
    updateSettings("print", values);
  };

  // Load stored printer + check WebUSB support on mount
  useEffect(() => {
    setWebusbSupported(isWebUsbSupported());
    setStoredPrinter(loadPrinter());
  }, []);

  const handleConnectUsbPrinter = async () => {
    setConnecting(true);
    try {
      const printer = await requestPrinter();
      if (printer) {
        savePrinter(printer);
        setStoredPrinter({
          ...printer,
          connectedAt: new Date().toISOString(),
        });
        toast({
          title: "Đã kết nối máy in",
          description: `${printer.manufacturer} — ${printer.name}`,
          variant: "success",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: "Không kết nối được máy in",
        description: msg,
        variant: "error",
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectUsbPrinter = () => {
    clearPrinter();
    setStoredPrinter(null);
    toast({
      title: "Đã ngắt kết nối máy in",
      variant: "info",
    });
  };

  const handleTestPrint = async () => {
    setTestStatus("testing");
    setTestError("");
    try {
      const result = await testPrint({ backend: print.backend });
      if (result.success) {
        setTestStatus("success");
        if (result.fallback) {
          setTestError(result.warning ?? "");
        }
      } else {
        setTestStatus("error");
        setTestError(result.warning ?? "Lỗi in thử");
      }
      setTimeout(() => {
        setTestStatus("idle");
        setTestError("");
      }, 4000);
    } catch (err) {
      setTestStatus("error");
      setTestError(err instanceof Error ? err.message : String(err));
      setTimeout(() => {
        setTestStatus("idle");
        setTestError("");
      }, 4000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt in ấn</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Cấu hình máy in, khổ giấy và mẫu in cho POS &amp; F&amp;B
        </p>
      </div>

      {/* ── 0. Print Backend (MỚI) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="tune" />
            Phương thức in
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {backends.map((b) => {
              const isActive = print.backend === b.id;
              const disabled = b.id === "escpos-usb" && !webusbSupported;
              return (
                <button
                  key={b.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => update({ backend: b.id })}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
                    isActive
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "border-border hover:border-primary/50",
                    disabled && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      name={b.icon}
                      className={cn(isActive ? "text-primary" : "text-muted-foreground")}
                    />
                    <span className="text-sm font-semibold">{b.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{b.desc}</span>
                  {disabled && (
                    <span className="mt-1 text-xs text-status-warning">
                      Trình duyệt hiện tại không hỗ trợ WebUSB — vui lòng dùng Chrome/Edge
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* USB Printer connection UI */}
          {print.backend === "escpos-usb" && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold">Máy in USB đã kết nối</h4>
                  {storedPrinter ? (
                    <div className="mt-1 text-sm">
                      <p>
                        <span className="text-muted-foreground">Hiệu:</span>{" "}
                        <span className="font-medium">{storedPrinter.manufacturer}</span>
                      </p>
                      <p>
                        <span className="text-muted-foreground">Tên:</span>{" "}
                        <span className="font-medium">{storedPrinter.name}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Vendor ID: 0x{storedPrinter.vendorId.toString(16).padStart(4, "0")} · Product ID: 0x{storedPrinter.productId.toString(16).padStart(4, "0")}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Chưa kết nối máy in nào. Bấm nút bên phải để chọn thiết bị.
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={handleConnectUsbPrinter}
                    disabled={connecting || !webusbSupported}
                  >
                    <Icon name="usb" size={16} className="mr-1.5" />
                    {connecting ? "Đang kết nối..." : storedPrinter ? "Đổi máy in" : "Kết nối máy in"}
                  </Button>
                  {storedPrinter && (
                    <Button size="sm" variant="outline" onClick={handleDisconnectUsbPrinter}>
                      Ngắt kết nối
                    </Button>
                  )}
                </div>
              </div>

              <Separator />

              <Toggle
                checked={print.openCashDrawer}
                onCheckedChange={(v) => update({ openCashDrawer: v })}
                label="Mở ngăn kéo tiền mặt"
                description="Tự động mở ngăn kéo khi thanh toán tiền mặt (cần máy in có cổng RJ11/RJ12 kết nối drawer)"
              />

              <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                <p className="font-medium">Lưu ý:</p>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  <li>WebUSB chỉ hoạt động trên Chrome, Edge, Opera (desktop + Android)</li>
                  <li>Yêu cầu HTTPS hoặc localhost</li>
                  <li>Khi reload trang, có thể phải kết nối lại (tuỳ browser)</li>
                  <li>Nếu máy in lỗi → hệ thống tự in qua trình duyệt → không mất đơn</li>
                </ul>
              </div>
            </div>
          )}

          {/* Test print */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="default"
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
              <span className="text-sm text-status-error">{testError || "Lỗi — kiểm tra kết nối"}</span>
            )}
          </div>
          {testStatus === "success" && testError && (
            <p className="text-xs text-status-warning">{testError}</p>
          )}
        </CardContent>
      </Card>

      {/* ── 1. Printer Connection (Legacy — chỉ hiển thị khi backend=browser để user chọn IP/Port nếu cần) ── */}
      {print.backend === "browser" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Icon name="cable" />
              Thông tin máy in (tham khảo)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Với phương thức &quot;Qua trình duyệt&quot;, hệ thống sẽ hiện hộp thoại chọn máy in của hệ điều hành
              — bạn không cần cấu hình IP. Các trường dưới đây chỉ để ghi chú.
            </p>
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

            {print.connectionType === "usb" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Tên máy in (tuỳ chọn)</label>
                <Input
                  value={print.printerName}
                  onChange={(e) => update({ printerName: e.target.value })}
                  placeholder="VD: EPSON TM-T82, Xprinter XP-58..."
                />
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
          </CardContent>
        </Card>
      )}

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
            Cài đặt in F&amp;B
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
