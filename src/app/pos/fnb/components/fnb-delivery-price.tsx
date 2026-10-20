"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { quoteDeliveryPrice, type DeliveryPricePolicy } from "@/lib/fnb-delivery-policy";
import { formatCurrency } from "@/lib/format";

export function FnbDeliveryPrice({ policy, meters, before, after, onChange }: {
  policy: DeliveryPricePolicy; meters?: number; before: number; after: number; onChange: (meters: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(meters === undefined ? "" : String(meters / 1000));
  const quote = quoteDeliveryPrice(policy, meters, before, after);
  const amount = policy.amountBasis === "before_discount" ? before : after;
  return <div className="space-y-2 rounded-lg border p-3">
    <label className="block space-y-1 text-sm font-medium">Khoảng cách giao (km)
      <Input aria-label="Khoảng cách giao (km)" inputMode="decimal" value={draft} placeholder="Ví dụ: 1,5"
        onChange={e => {
          const value = e.target.value;
          setDraft(value);
          const normalized = value.replace(",", ".");
          const valid = /^\d+(?:\.\d{0,3})?$/.test(normalized);
          onChange(valid ? Math.round(Number(normalized) * 1000) : undefined);
        }} />
    </label>
    <p className="text-xs text-muted-foreground">Bill {policy.amountBasis === "before_discount" ? "trước" : "sau"} giảm giá: {formatCurrency(amount)}đ. Chưa gồm phí giao và tip.</p>
    <p role="status" className="text-sm">{quote ? `${quote.name} · ${quote.fee === 0 ? "Miễn phí giao hàng" : `${formatCurrency(quote.fee)}đ`}`
      : meters === undefined ? "Nhập khoảng cách để tính phí giao."
        : "Chưa có mức phí phù hợp. Kiểm tra cấu hình trước khi gửi đơn."}</p>
  </div>;
}
