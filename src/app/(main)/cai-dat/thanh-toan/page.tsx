"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Save, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

function Toggle({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
        checked ? "bg-primary" : "bg-muted",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}

const paymentMethods = [
  { id: "cash", name: "Tiền mặt", icon: "VND", alwaysOn: true },
  { id: "transfer", name: "Chuyển khoản", icon: "CK", alwaysOn: false },
  { id: "card", name: "Thẻ tín dụng/ghi nợ", icon: "CARD", alwaysOn: false },
  { id: "momo", name: "Ví MoMo", icon: "MoMo", alwaysOn: false },
  { id: "zalopay", name: "Ví ZaloPay", icon: "Zalo", alwaysOn: false },
  { id: "vnpay", name: "VNPay", icon: "VNP", alwaysOn: false },
];

const bankAccounts = [
  {
    id: 1,
    bank: "Vietcombank",
    accountNumber: "1234567890",
    accountName: "NGUYEN VAN A",
    branch: "Chi nhánh HCM",
  },
  {
    id: 2,
    bank: "Techcombank",
    accountNumber: "9876543210",
    accountName: "NGUYEN VAN A",
    branch: "Chi nhánh Hà Nội",
  },
  {
    id: 3,
    bank: "MB Bank",
    accountNumber: "5678901234",
    accountName: "NGUYEN VAN A",
    branch: "Chi nhánh Đà Nẵng",
  },
];

export default function PaymentSettingsPage() {
  const [enabledMethods, setEnabledMethods] = useState<Record<string, boolean>>(
    {
      cash: true,
      transfer: true,
      card: true,
      momo: false,
      zalopay: false,
      vnpay: true,
    }
  );

  const [showQr, setShowQr] = useState(true);

  const toggleMethod = (id: string) => {
    setEnabledMethods((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt thanh toán</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Quản lý phương thức thanh toán và tài khoản ngân hàng
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phương thức thanh toán</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {paymentMethods.map((method) => (
              <div
                key={method.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-xs font-bold">
                    {method.icon}
                  </div>
                  <div>
                    <span className="text-sm font-medium">{method.name}</span>
                    {method.alwaysOn && (
                      <p className="text-xs text-muted-foreground">
                        Luôn bật
                      </p>
                    )}
                  </div>
                </div>
                <Toggle
                  checked={enabledMethods[method.id] ?? false}
                  onCheckedChange={() => toggleMethod(method.id)}
                  label={method.name}
                  disabled={method.alwaysOn}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tài khoản ngân hàng</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tên ngân hàng</TableHead>
                  <TableHead>Số TK</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Chủ TK
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    Chi nhánh
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bankAccounts.map((acc) => (
                  <TableRow key={acc.id}>
                    <TableCell className="font-medium">{acc.bank}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {acc.accountNumber}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {acc.accountName}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {acc.branch}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cài đặt QR</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <QrCode className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <div className="text-sm font-medium">Hiển thị mã QR</div>
                <div className="text-xs text-muted-foreground">
                  Hiển thị mã QR thanh toán trên hóa đơn
                </div>
              </div>
            </div>
            <Toggle
              checked={showQr}
              onCheckedChange={setShowQr}
              label="QR"
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
