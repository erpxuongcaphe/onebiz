"use client";

/**
 * Cài đặt thanh toán — Settings overview.
 *
 * Sprint CD-1: trước đây toàn page MOCK — bankAccounts hardcoded
 * (Vietcombank/Techcombank/MB Bank số TK giả của "NGUYEN VAN A"),
 * `enabledMethods` chỉ local state không persist DB, button "Lưu" vô
 * tác dụng. CEO đăng nhập thấy 3 tài khoản ngân hàng tưởng đã setup
 * → in QR sai → khách chuyển khoản nhầm.
 *
 * Fix tạm: page này giờ chỉ là **overview** trỏ về 2 nguồn config thật:
 *   - Tài khoản ngân hàng → /he-thong/thiet-lap (tenant business info,
 *     section "Tài khoản ngân hàng")
 *   - Phương thức thanh toán → đã hardcoded ở schema cash_transactions
 *     check constraint (cash/transfer/card/ewallet sau migration 00046).
 *     Toggle UI là feature defer (chưa có DB column).
 */

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";

export default function PaymentSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt thanh toán</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Phương thức thanh toán và tài khoản ngân hàng
        </p>
      </div>

      {/* Bank account → tenant business info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="account_balance" size={18} className="text-status-success" />
            Tài khoản ngân hàng
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Tài khoản ngân hàng dùng để in QR + thông tin chuyển khoản trên
            hóa đơn được cấu hình tại trang Thiết lập chung — section "Tài
            khoản ngân hàng".
          </p>
          <Link
            href="/he-thong/thiet-lap"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Icon name="settings" size={16} />
            Mở Thiết lập chung
          </Link>
        </CardContent>
      </Card>

      {/* Payment methods — hiển thị các phương thức được hệ thống hỗ trợ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="payments" size={18} className="text-primary" />
            Phương thức thanh toán hỗ trợ
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { code: "cash", label: "Tiền mặt", icon: "payments", enabled: true },
              { code: "transfer", label: "Chuyển khoản", icon: "account_balance", enabled: true },
              { code: "card", label: "Thẻ tín dụng/ghi nợ", icon: "credit_card", enabled: true },
              { code: "ewallet", label: "Ví điện tử (Momo/Zalo/VNPay)", icon: "account_balance_wallet", enabled: true },
            ].map((m) => (
              <div
                key={m.code}
                className="flex items-center gap-3 p-3 rounded-lg border bg-surface-container-lowest"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                  <Icon name={m.icon} size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{m.label}</div>
                  <div className="text-xs text-muted-foreground font-mono">{m.code}</div>
                </div>
                <Badge
                  variant="outline"
                  className="bg-status-success/10 text-status-success border-status-success/25 text-xs"
                >
                  Đã bật
                </Badge>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Tất cả phương thức trên đều được POS Retail / FnB hỗ trợ ngay.
            Tích hợp cổng thanh toán thật (VNPay/Momo) đang phát triển — xem
            tại{" "}
            <Link href="/cai-dat/ket-noi" className="text-primary hover:underline">
              Tích hợp
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      {/* QR settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="qr_code" size={18} className="text-status-warning" />
            Mã QR thanh toán
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 p-3 rounded-md bg-status-warning/5 border border-status-warning/20">
            <Icon
              name="info"
              size={16}
              className="text-status-warning mt-0.5 shrink-0"
            />
            <div className="text-xs">
              <p className="font-medium text-foreground">Đang phát triển</p>
              <p className="text-muted-foreground mt-1">
                Tính năng tự động tạo QR VietQR/Vietinpay từ thông tin tài
                khoản ngân hàng đang được phát triển. Hiện CEO có thể đính
                kèm QR static qua Logo URL ở Thiết lập chung.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
