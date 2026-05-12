"use client";

/**
 * Cấp OTP duyệt từ xa — trang DESKTOP cho admin tree.
 *
 * Route: `/cap-otp` — wrap trong (main) layout → có sidebar + topnav như
 * mọi trang admin. User quay về trang chủ qua sidebar/topnav tự nhiên.
 *
 * CEO 12/05: tách khỏi `/manager/otp` (vốn là PWA mobile) để desktop user
 * không bị nhảy về Manager portal khi bấm back.
 *
 * Logic + UI giống `/manager/otp` — share qua `<OtpIssuerContent />`.
 */

import { PageHeader } from "@/components/shared/page-header";
import { OtpIssuerContent } from "@/components/shared/otp-issuer-content";

export default function CapOtpPage() {
  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Cấp OTP duyệt từ xa"
        subtitle="Cấp mã 6 số (TTL 2 phút, dùng 1 lần) cho cashier xin duyệt action nhạy cảm — xoá bill, giảm giá vượt mức, huỷ bill đã thanh toán, sửa món sent, xoá KH/NCC."
      />
      <div className="mt-4">
        <OtpIssuerContent />
      </div>
    </div>
  );
}
