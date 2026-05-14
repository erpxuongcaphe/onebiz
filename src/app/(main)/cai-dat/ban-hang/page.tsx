"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useSettings, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatNumber } from "@/lib/format";

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

export default function SalesSettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { toast } = useToast();

  const [allowSellOutOfStock, setAllowSellOutOfStock] = useState(
    settings.sales.allowSellOutOfStock
  );
  const [requireCustomer, setRequireCustomer] = useState(
    settings.sales.requireCustomer
  );
  const [autoPrintInvoice, setAutoPrintInvoice] = useState(
    settings.sales.autoPrintInvoice
  );
  const [showCostOnPos, setShowCostOnPos] = useState(
    settings.sales.showCostOnPos
  );

  const [discountType, setDiscountType] = useState<"percent" | "fixed">(
    settings.sales.discountType
  );
  const [maxDiscount, setMaxDiscount] = useState(
    String(settings.sales.maxDiscount)
  );

  const [supervisorPin, setSupervisorPin] = useState(
    settings.sales.supervisorPin
  );
  const [supervisorDiscountAmountThreshold, setSupervisorDiscountAmountThreshold] = useState(
    String(settings.sales.supervisorDiscountAmountThreshold)
  );
  const [showPin, setShowPin] = useState(false);

  const [paymentCash, setPaymentCash] = useState(
    settings.sales.paymentMethods.cash
  );
  const [paymentTransfer, setPaymentTransfer] = useState(
    settings.sales.paymentMethods.transfer
  );
  const [paymentCard, setPaymentCard] = useState(
    settings.sales.paymentMethods.card
  );
  const [paymentEwallet, setPaymentEwallet] = useState(
    settings.sales.paymentMethods.ewallet
  );

  function handleSave() {
    // Validate PIN: 4-8 chữ số hoặc rỗng (tắt)
    const pinTrimmed = supervisorPin.trim();
    if (pinTrimmed && !/^\d{4,8}$/.test(pinTrimmed)) {
      toast({
        title: "Mã PIN không hợp lệ",
        description: "PIN phải là 4-8 chữ số, hoặc để trống để tắt xác thực.",
        variant: "error",
      });
      return;
    }
    const thresholdNum = Number(supervisorDiscountAmountThreshold);
    if (pinTrimmed && (!Number.isFinite(thresholdNum) || thresholdNum < 0)) {
      toast({
        title: "Ngưỡng chiết khấu không hợp lệ",
        description: "Nhập số tiền VND lớn hơn hoặc bằng 0.",
        variant: "error",
      });
      return;
    }

    updateSettings("sales", {
      allowSellOutOfStock,
      requireCustomer,
      autoPrintInvoice,
      showCostOnPos,
      discountType,
      maxDiscount: Number(maxDiscount),
      supervisorPin: pinTrimmed,
      supervisorDiscountAmountThreshold: thresholdNum || 0,
      paymentMethods: {
        cash: paymentCash,
        transfer: paymentTransfer,
        card: paymentCard,
        ewallet: paymentEwallet,
      },
    });
    toast({
      title: "Lưu thành công",
      description: "Cài đặt bán hàng đã được cập nhật.",
      variant: "success",
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt bán hàng</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Tùy chỉnh quy tắc và phương thức bán hàng
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quy tắc bán hàng</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <Toggle
              checked={allowSellOutOfStock}
              onCheckedChange={setAllowSellOutOfStock}
              label="Cho phép bán khi hết hàng"
              description="Cho phép tạo đơn hàng khi sản phẩm hết tồn kho"
            />
            <Toggle
              checked={requireCustomer}
              onCheckedChange={setRequireCustomer}
              label="Bắt buộc chọn khách hàng"
              description="Yêu cầu chọn khách hàng trước khi tạo đơn"
            />
            <Toggle
              checked={autoPrintInvoice}
              onCheckedChange={setAutoPrintInvoice}
              label="Tự động in hóa đơn sau thanh toán"
              description="In hóa đơn ngay sau khi thanh toán thành công"
            />
            <Toggle
              checked={showCostOnPos}
              onCheckedChange={setShowCostOnPos}
              label="Hiển thị giá vốn trên POS"
              description="Cho phép xem giá vốn trên màn hình bán hàng"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Giảm giá mặc định</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Loại giảm giá</label>
              <Select value={discountType} onValueChange={(v) => v && setDiscountType(v as "percent" | "fixed")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn loại">
                    {(v) =>
                      v === "percent"
                        ? "Phần trăm (%)"
                        : v === "fixed"
                          ? "Số tiền cố định (VND)"
                          : "Chọn loại"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Phần trăm (%)</SelectItem>
                  <SelectItem value="fixed">Số tiền cố định (VND)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Giảm giá tối đa (%)
              </label>
              <Input
                type="number"
                value={maxDiscount}
                onChange={(e) => setMaxDiscount(e.target.value)}
                min={0}
                max={100}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="vpn_key" size={18} className="text-status-warning" />
            Duyệt giảm giá vượt ngưỡng — qua OTP per-user
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="rounded-md bg-status-success/5 border border-status-success/30 p-3 text-xs">
              <div className="flex items-start gap-2">
                <Icon name="check_circle" size={16} className="text-status-success shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Đã nâng cấp sang OTP per-user</p>
                  <p className="text-muted-foreground mt-1">
                    Từ Sprint B.6 (CEO 12/05/2026), giảm giá vượt ngưỡng KHÔNG còn dùng PIN chung. Mỗi
                    quản lý có quyền <code className="bg-muted px-1 rounded text-[10px]">pos_fnb.discount</code>
                    {" "}vào <Link href="/cap-otp" className="text-primary underline">/cap-otp</Link> để cấp OTP 6 số
                    (TTL 2 phút). Cashier nhập OTP → server verify manager đã duyệt → audit log lưu cả 2.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Ngưỡng tiền cần OTP duyệt (VND)
              </label>
              <Input
                type="number"
                value={supervisorDiscountAmountThreshold}
                onChange={(e) => setSupervisorDiscountAmountThreshold(e.target.value)}
                min={0}
                step={10000}
                placeholder="500000"
              />
              <div className="text-xs text-muted-foreground">
                Chiết khấu vượt {formatNumber(Number(supervisorDiscountAmountThreshold || 0))} ₫
                {" "}hoặc vượt % tối đa ở trên → yêu cầu OTP từ manager. Mặc định 500.000 ₫.
              </div>
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Cấu hình PIN supervisor cũ (deprecated)
              </summary>
              <div className="mt-2 p-3 rounded-md border border-status-warning/30 bg-status-warning/5">
                <p className="text-foreground mb-2">
                  ⚠️ PIN chung cũ đã bị bỏ. Trường này KHÔNG còn được POS dùng — sẽ xoá sau 2 tuần
                  để backward compat. Để rỗng nếu không cần.
                </p>
                <div className="flex gap-2 items-center">
                  <Input
                    type={showPin ? "text" : "password"}
                    value={supervisorPin}
                    onChange={(e) => setSupervisorPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    placeholder="(deprecated)"
                    maxLength={8}
                    inputMode="numeric"
                    autoComplete="off"
                    className="font-mono tracking-widest opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((v) => !v)}
                    className="text-muted-foreground hover:text-foreground p-1"
                    aria-label={showPin ? "Ẩn PIN" : "Hiện PIN"}
                  >
                    <Icon name={showPin ? "visibility_off" : "visibility"} size={16} />
                  </button>
                </div>
              </div>
            </details>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phương thức thanh toán</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              {
                label: "Tiền mặt",
                checked: paymentCash,
                onChange: setPaymentCash,
              },
              {
                label: "Chuyển khoản",
                checked: paymentTransfer,
                onChange: setPaymentTransfer,
              },
              {
                label: "Thẻ (Credit/Debit)",
                checked: paymentCard,
                onChange: setPaymentCard,
              },
              {
                label: "Ví điện tử",
                checked: paymentEwallet,
                onChange: setPaymentEwallet,
              },
            ].map((method) => (
              <label
                key={method.label}
                className="flex items-center gap-3 cursor-pointer"
              >
                <Checkbox
                  checked={method.checked}
                  onCheckedChange={(val) => method.onChange(val === true)}
                />
                <span className="text-sm">{method.label}</span>
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
