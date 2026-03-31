"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

function Toggle({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium">{label}</span>
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

export default function InvoiceSettingsPage() {
  const [prefix, setPrefix] = useState("HD");
  const [startNumber, setStartNumber] = useState("000001");
  const [separator, setSeparator] = useState("-");

  const [showCustomerName, setShowCustomerName] = useState(true);
  const [showCustomerPhone, setShowCustomerPhone] = useState(true);
  const [showProductCode, setShowProductCode] = useState(false);
  const [showDiscount, setShowDiscount] = useState(true);
  const [showTax, setShowTax] = useState(true);
  const [showNote, setShowNote] = useState(true);
  const [showPaymentMethod, setShowPaymentMethod] = useState(true);

  const previewCode = `${prefix}${separator}${startNumber}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt hóa đơn</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Tùy chỉnh định dạng và nội dung hóa đơn
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Định dạng mã hóa đơn</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tiền tố</label>
              <Input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="HD"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Ký tự phân cách</label>
              <Select value={separator} onValueChange={(v) => v !== null && setSeparator(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="-">Dấu gạch ngang (-)</SelectItem>
                  <SelectItem value="/">Dấu gạch chéo (/)</SelectItem>
                  <SelectItem value=".">Dấu chấm (.)</SelectItem>
                  <SelectItem value="">Không có</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Số bắt đầu</label>
              <Input
                value={startNumber}
                onChange={(e) => setStartNumber(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground mb-1">Xem trước:</p>
            <p className="text-sm font-mono font-semibold">{previewCode}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mẫu hóa đơn</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-muted/30 p-6 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Xem trước mẫu hóa đơn
            </p>
            <Button variant="outline" size="sm" className="mt-3">
              Tùy chỉnh mẫu
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Thông tin hiển thị</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <Toggle
              checked={showCustomerName}
              onCheckedChange={setShowCustomerName}
              label="Tên khách hàng"
            />
            <Toggle
              checked={showCustomerPhone}
              onCheckedChange={setShowCustomerPhone}
              label="SĐT khách hàng"
            />
            <Toggle
              checked={showProductCode}
              onCheckedChange={setShowProductCode}
              label="Mã sản phẩm"
            />
            <Toggle
              checked={showDiscount}
              onCheckedChange={setShowDiscount}
              label="Giảm giá"
            />
            <Toggle
              checked={showTax}
              onCheckedChange={setShowTax}
              label="Thuế"
            />
            <Toggle
              checked={showNote}
              onCheckedChange={setShowNote}
              label="Ghi chú"
            />
            <Toggle
              checked={showPaymentMethod}
              onCheckedChange={setShowPaymentMethod}
              label="Phương thức thanh toán"
            />
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
