"use client";

import { useState } from "react";
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
import { Save } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [allowSellOutOfStock, setAllowSellOutOfStock] = useState(false);
  const [requireCustomer, setRequireCustomer] = useState(false);
  const [autoPrintInvoice, setAutoPrintInvoice] = useState(true);
  const [showCostOnPos, setShowCostOnPos] = useState(false);

  const [discountType, setDiscountType] = useState("percent");
  const [maxDiscount, setMaxDiscount] = useState("50");

  const [paymentCash, setPaymentCash] = useState(true);
  const [paymentTransfer, setPaymentTransfer] = useState(true);
  const [paymentCard, setPaymentCard] = useState(true);
  const [paymentEwallet, setPaymentEwallet] = useState(false);

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
              <Select value={discountType} onValueChange={(v) => v && setDiscountType(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
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
        <Button>
          <Save className="h-4 w-4 mr-1.5" />
          Lưu thay đổi
        </Button>
      </div>
    </div>
  );
}
