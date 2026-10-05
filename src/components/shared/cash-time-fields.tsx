"use client";

import { Input } from "@/components/ui/input";
import { useState } from "react";
import { cashDateTimeInput } from "@/lib/cash-time";

export interface CashTimeDraft {
  occurredLocal: string;
  transactionDate: string;
  timeReason: string;
}

function initialCashTime(): CashTimeDraft {
  const at = cashDateTimeInput();
  return { occurredLocal: at, transactionDate: at.slice(0, 10), timeReason: "" };
}

export function useCashTimeDraft(open: boolean) {
  const [wasOpen, setWasOpen] = useState(open);
  const [cashTime, setCashTime] = useState<CashTimeDraft>(initialCashTime);
  // Reset on a dialog opening before its children render; no stale prior date.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setCashTime(initialCashTime());
  }
  return { cashTime, setCashTime };
}

export function CashTimeFields({ value, onChange, error }: {
  value: CashTimeDraft;
  onChange: (value: CashTimeDraft) => void;
  error?: string;
}) {
  return (
    <fieldset className="grid gap-2 border-t pt-3">
      <legend className="text-sm font-semibold text-primary">Ngày giờ thu/chi · giờ Việt Nam (UTC+7)</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Thời điểm thực thu/chi
          <Input type="datetime-local" value={value.occurredLocal}
            onChange={(e) => onChange({ ...value, occurredLocal: e.target.value, transactionDate: e.target.value.slice(0, 10) })}
            aria-invalid={!!error} />
        </label>
        <label className="grid gap-1 text-sm">
          Ngày hạch toán
          <Input type="date" value={value.transactionDate}
            onChange={(e) => onChange({ ...value, transactionDate: e.target.value })} />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        Lý do nhập lùi ngày / khác ngày
        <Input value={value.timeReason} onChange={(e) => onChange({ ...value, timeReason: e.target.value })}
          placeholder="Ví dụ: ghi nhận chuyển khoản hôm qua" />
      </label>
      <p className="text-xs text-muted-foreground">Bộ lọc và số dư theo ngày hạch toán. Giờ tạo trên hệ thống được lưu riêng.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </fieldset>
  );
}
