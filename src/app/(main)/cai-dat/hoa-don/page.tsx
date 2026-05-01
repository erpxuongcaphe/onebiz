"use client";

/**
 * Cài đặt hóa đơn — Settings overview.
 *
 * Sprint CD-1: trước đây toàn local state — prefix/startNumber/separator
 * + 7 toggle "Hiển thị" KHÔNG persist DB, button "Lưu" không có handler.
 * CEO sửa toggle, reload mất hết.
 *
 * Fix tạm: page này giờ trỏ về 2 nguồn config thật:
 *   - Header hóa đơn (tên DN, MST, logo, footer) → /he-thong/thiet-lap
 *   - Khổ giấy + máy in nhiệt 80mm/A4 → /cai-dat/in-an
 *
 * Mã hóa đơn (prefix, sequence) hiện được auto-generate bởi RPC
 * `next_code` ở Postgres (không config UI). Đó là pattern chuẩn:
 * tenant không cần đụng đến.
 */

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

export default function InvoiceSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt hóa đơn</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Định dạng và nội dung hiển thị trên hóa đơn
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Icon name="business" size={18} className="text-primary" />
              Thông tin doanh nghiệp
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Tên DN, MST, địa chỉ, logo và footer hóa đơn được cấu hình tại
              trang Thiết lập chung.
            </p>
            <Link
              href="/he-thong/thiet-lap"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Icon name="settings" size={16} />
              Mở Thiết lập chung
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Icon name="print" size={18} className="text-status-success" />
              Khổ giấy &amp; máy in
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Cấu hình máy in nhiệt 58mm / 80mm / A4, ESC/POS, mở ngăn kéo
              tiền và in test tại trang In ấn.
            </p>
            <Link
              href="/cai-dat/in-an"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Icon name="print" size={16} />
              Mở Cài đặt in ấn
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="tag" size={18} className="text-status-warning" />
            Mã hóa đơn (prefix &amp; sequence)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm space-y-2">
            <p className="text-muted-foreground">
              Mã hóa đơn được tự động tạo theo pattern của hệ thống:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>
                <code className="text-foreground font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  HD000001
                </code>{" "}
                — Hóa đơn POS Retail
              </li>
              <li>
                <code className="text-foreground font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  PT000001
                </code>{" "}
                — Phiếu thu (sổ quỹ)
              </li>
              <li>
                <code className="text-foreground font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  PC000001
                </code>{" "}
                — Phiếu chi (sổ quỹ)
              </li>
              <li>
                <code className="text-foreground font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  HDN-CPH-001
                </code>{" "}
                — Đơn nhập café (theo nhóm SP)
              </li>
            </ul>
            <p className="text-muted-foreground mt-3">
              Sequence được giữ atomic ở Postgres RPC{" "}
              <code className="font-mono text-xs">next_code</code> — không
              trùng kể cả khi 2 cashier checkout cùng lúc. Custom prefix
              theo tenant đang phát triển.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="visibility" size={18} className="text-muted-foreground" />
            Tùy chỉnh hiển thị (đang phát triển)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 p-3 rounded-md bg-status-warning/5 border border-status-warning/20">
            <Icon name="info" size={16} className="text-status-warning mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-medium text-foreground">Đang phát triển</p>
              <p className="text-muted-foreground mt-1">
                Tùy chỉnh ẩn/hiện các trường (mã SP, thuế, ghi chú, phương
                thức TT) trên hóa đơn đang được phát triển. Hiện hệ thống
                in tất cả các trường mặc định theo template chuẩn.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
