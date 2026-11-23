"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { quoteDeliveryPrice, resolveDeliveryDistanceMeters, type DeliveryDistanceRange, type DeliveryPricePolicy } from "@/lib/fnb-delivery-policy";
import type { DeliveryPlatformSettings } from "@/lib/services/supabase/fnb-platform-settings";
import type { FnbServiceDelivery } from "@/lib/services/supabase/fnb-order-service";
import type { DeliveryPlatform } from "@/lib/types/fnb";
import { FnbDeliveryPrice } from "./fnb-delivery-price";

const platforms = { direct: "Tự giao", shopee_food: "ShopeeFood", grab_food: "GrabFood", gojek: "Gojek", be: "beFood" } as const;

export function FnbChangeDeliveryDialog({ policy, policyError, onRetryPolicy, settings, before, after, tiers, busy, onClose, onConfirm }: {
  policy: DeliveryPricePolicy | null;
  policyError: string;
  onRetryPolicy: () => void;
  settings: DeliveryPlatformSettings | null;
  before: number;
  after: number;
  tiers: { code: "near" | "mid" | "far"; label: string; fee: number }[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (delivery: FnbServiceDelivery) => void;
}) {
  const [platform, setPlatform] = useState<DeliveryPlatform>("direct");
  const [distance, setDistance] = useState<{ meters?: number; range?: DeliveryDistanceRange }>({});
  const [tier, setTier] = useState<NonNullable<FnbServiceDelivery["tier"]>>("custom");
  const [manualFee, setManualFee] = useState("0");
  const isDirect = platform === "direct";
  const quote = policy && quoteDeliveryPrice(policy, resolveDeliveryDistanceMeters(policy, distance.meters, distance.range), before, after);
  const selectedTier = tiers.find(item => item.code === tier);
  const manual = /^\d+$/.test(manualFee) && Number.isSafeInteger(Number(manualFee)) ? Number(manualFee) : undefined;
  const fee = !isDirect ? 0 : policy?.enabled ? quote?.fee : tier === "custom" ? manual : selectedTier?.fee;
  const ready = fee !== undefined && (isDirect ? Boolean(policy) && !policyError && settings?.direct.active !== false : !!settings?.[platform].active);

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Chuyển sang giao hàng</DialogTitle>
        <DialogDescription>Giữ nguyên bill và các món đã gửi bếp. Chọn cách giao để cập nhật phí trên bill.</DialogDescription>
      </DialogHeader>
      <fieldset disabled={busy} className="min-h-0 space-y-3 overflow-y-auto overscroll-contain">
        <label className="block space-y-1 text-sm font-medium">Sàn giao hàng
          <select className="h-11 w-full rounded-md border bg-background px-2" value={platform} onChange={event => setPlatform(event.target.value as DeliveryPlatform)}>
            {Object.entries(platforms).filter(([key]) => key === "direct" || settings?.[key as DeliveryPlatform].active)
              .map(([key, name]) => <option key={key} value={key} disabled={settings?.[key as DeliveryPlatform].active === false}>{settings?.[key as DeliveryPlatform].label ?? name}</option>)}
          </select>
        </label>
        {isDirect && (policyError ? <div role="alert" className="text-sm">{policyError} <Button type="button" variant="outline" onClick={onRetryPolicy}>Thử lại</Button></div>
          : !policy ? <p role="status" className="text-sm">Đang tải chính sách phí giao…</p>
          : policy.enabled ? <FnbDeliveryPrice policy={policy} meters={distance.meters} range={distance.range} before={before} after={after}
            onChange={(meters, range) => setDistance({ meters, range })} />
          : <>
            {tiers.length > 0 && <label className="block space-y-1 text-sm font-medium">Mức phí giao
              <select className="h-11 w-full rounded-md border bg-background px-2" value={tier} onChange={event => setTier(event.target.value as typeof tier)}>
                <option value="custom">Tự nhập phí</option>
                {tiers.map(item => <option key={item.code} value={item.code}>{item.label} · {formatCurrency(item.fee)}đ</option>)}
              </select>
            </label>}
            {tier === "custom" && <label className="block space-y-1 text-sm font-medium">Phí giao khách trả (đ)
              <Input inputMode="numeric" value={manualFee} onChange={event => setManualFee(event.target.value)} />
            </label>}
          </>)}
      </fieldset>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Đóng</Button>
        <Button type="button" disabled={busy || !ready} onClick={() => {
          if (fee === undefined || !ready) return;
          onConfirm({ platform, fee, tier: isDirect ? policy?.enabled ? "custom" : tier : undefined, policyRevision: isDirect ? policy?.revision : undefined });
        }}>{busy ? "Đang lưu…" : "Chuyển sang giao hàng"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
