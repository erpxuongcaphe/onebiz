"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { quoteDeliveryPrice, getDeliveryDistancePresets, formatDeliveryDistanceRange, resolveDeliveryDistanceMeters, type DeliveryPricePolicy, type DeliveryDistanceRange } from "@/lib/fnb-delivery-policy";
import { formatCurrency } from "@/lib/format";

function parseDistance(value: string): number | undefined {
  const normalized = value.replace(",", ".");
  const meters = /^\d+(?:\.\d{0,3})?$/.test(normalized) ? Math.round(Number(normalized) * 1000) : NaN;
  return Number.isSafeInteger(meters) && meters >= 0 ? meters : undefined;
}

export function FnbDeliveryPrice({ policy, meters, range, before, after, onChange, compact = false }: {
  policy: DeliveryPricePolicy; meters?: number; range?: DeliveryDistanceRange; before: number; after: number;
  onChange: (meters: number | undefined, range?: DeliveryDistanceRange) => void;
  compact?: boolean;
}) {
  const distanceId = useId();
  const [custom, setCustom] = useState(!range && meters !== undefined);
  const [entry, setEntry] = useState({ draft: !range && meters !== undefined ? String(meters / 1000) : "", published: meters });
  // Keep externally restored drafts in sync without removing a typed decimal comma.
  if (!range && meters !== entry.published) {
    setEntry({ draft: meters === undefined ? "" : String(meters / 1000), published: meters });
  }
  const presets = getDeliveryDistancePresets(policy);
  const resolvedMeters = resolveDeliveryDistanceMeters(policy, meters, range);
  const quote = quoteDeliveryPrice(policy, resolvedMeters, before, after);
  const amount = policy.amountBasis === "before_discount" ? before : after;
  if (compact) {
    const selected = !custom && range ? presets.findIndex(p => p.fromMeters === range.fromMeters && p.toMeters === range.toMeters) : -1;
    const stale = !custom && Boolean(range) && (selected < 0 || resolvedMeters === undefined);
    return <div className="min-w-0 space-y-1">
      <label className="flex h-6 items-center text-[11px] font-medium text-muted-foreground" htmlFor={distanceId}>Khoảng cách</label>
      <select id={distanceId} aria-label="Khoảng cách giao" value={custom ? "custom" : stale ? "stale" : selected < 0 ? "" : String(selected)}
        className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-xs [@media(pointer:coarse)]:h-10"
        onChange={event => {
          if (!event.target.value || event.target.value === "stale") return;
          if (event.target.value === "custom") {
            setCustom(true);
            const next = parseDistance(entry.draft);
            setEntry({ draft: entry.draft, published: next });
            onChange(next);
          } else {
            const preset = presets[Number(event.target.value)];
            if (preset) { setCustom(false); onChange(preset.fromMeters, preset); }
          }
        }}>
        <option value="" disabled>Chọn khoảng cách</option>
        {stale && <option value="stale" disabled>Chọn lại khoảng cách</option>}
        {presets.map((preset,index) => <option key={`${preset.fromMeters}:${preset.toMeters}`} value={String(index)}>{formatDeliveryDistanceRange(preset)}</option>)}
        <option value="custom">Tự nhập km</option>
      </select>
      {custom && <Input aria-label="Khoảng cách giao (km)" inputMode="decimal" value={entry.draft} placeholder="Nhập km, vd: 1.5"
        className="h-9 min-h-9 text-xs" onChange={event => {
          const draft = event.target.value, next = parseDistance(draft);
          setEntry({ draft, published: next }); onChange(next);
        }} />}
      {(quote || stale || resolvedMeters !== undefined) && <p role="status" className="text-[11px] leading-4" title={`Bill ${policy.amountBasis === "before_discount" ? "trước" : "sau"} giảm giá: ${formatCurrency(amount)}đ; chưa gồm phí giao và tip.`}>
        {quote ? quote.fee === 0 ? "Miễn phí giao" : `Phí giao ${formatCurrency(quote.fee)}đ` : stale ? "Khoảng cách đổi, chọn lại." : "Chưa có mức phí phù hợp."}
      </p>}
    </div>;
  }
  return <div className="space-y-2 rounded-lg border p-3">
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Khoảng cách giao</legend>
      <div className="grid grid-cols-2 gap-2">
        {presets.map(preset => {
          const selected = !custom && resolvedMeters !== undefined && range?.fromMeters === preset.fromMeters && range.toMeters === preset.toMeters;
          return <button key={`${preset.fromMeters}:${preset.toMeters}`} type="button" aria-pressed={selected}
            className={`min-h-11 rounded-md border px-2 py-2 text-sm ${selected ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}
            onClick={() => { setCustom(false); onChange(preset.fromMeters, preset); }}>
            {formatDeliveryDistanceRange(preset)}
          </button>;
        })}
        <button type="button" aria-pressed={custom} className={`col-span-2 min-h-11 rounded-md border px-2 py-2 text-sm ${custom ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}
          onClick={() => {
            setCustom(true);
            const next = parseDistance(entry.draft);
            setEntry({ draft: entry.draft, published: next });
            onChange(next);
          }}>Tự nhập khoảng cách</button>
      </div>
      {custom ? <label className="block space-y-1 text-sm font-medium">Khoảng cách giao (km)
        <Input aria-label="Khoảng cách giao (km)" inputMode="decimal" value={entry.draft} placeholder="Ví dụ: 1,5"
          onChange={e => {
            const draft = e.target.value;
            const next = parseDistance(draft);
            setEntry({ draft, published: next });
            onChange(next);
          }} />
      </label> : null}
    </fieldset>
    <p className="text-xs text-muted-foreground">Bill {policy.amountBasis === "before_discount" ? "trước" : "sau"} giảm giá: {formatCurrency(amount)}đ. Chưa gồm phí giao và tip.</p>
    <p role="status" className="text-sm">{quote ? `${quote.name} · ${quote.fee === 0 ? "Miễn phí giao hàng" : `${formatCurrency(quote.fee)}đ`}`
      : range && resolvedMeters === undefined ? "Khoảng cách đã thay đổi trong cấu hình. Chọn lại khoảng cách."
        : meters === undefined ? "Chọn khoảng cách hoặc tự nhập để tính phí giao."
          : "Chưa có mức phí phù hợp. Kiểm tra cấu hình trước khi gửi đơn."}</p>
  </div>;
}
