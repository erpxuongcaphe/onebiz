/**
 * FnB Platform Settings Service — Sprint POS-FNB-EXT-1 (CEO 08/05).
 *
 * Lưu trữ:
 *   - Cấu hình mặc định 5 sàn giao đồ ăn (Shopee Food / Grab Food / Gojek /
 *     Be / Tự giao) với commission % mặc định + active flag.
 *   - Discount presets ("Khuyến mãi nhanh") cho cart dropdown chọn nhanh.
 *
 * Schema: tenants.settings.fnb_delivery_platforms + .fnb_discount_presets
 * (JSONB) — không cần migration mới.
 */

import { getClient, getCurrentTenantId, handleError } from "./base";
import type { DeliveryPlatform } from "@/lib/types/fnb";

// ============================================================
// Delivery platform settings
// ============================================================

export interface DeliveryPlatformConfig {
  /** Hiện trên cart dropdown khi orderType="delivery". */
  active: boolean;
  /** % chiết khấu sàn lấy của quán mặc định (0-100). */
  commissionPercent: number;
  /** Display label override (default = vendor brand name). */
  label?: string;
}

export type DeliveryPlatformSettings = Record<
  DeliveryPlatform,
  DeliveryPlatformConfig
>;

/** Default: theo industry standard VN 2025 — Shopee/Grab 25%, Gojek 25%, Be 20%. */
export const DEFAULT_DELIVERY_PLATFORM_SETTINGS: DeliveryPlatformSettings = {
  shopee_food: { active: true, commissionPercent: 25 },
  grab_food: { active: true, commissionPercent: 25 },
  gojek: { active: true, commissionPercent: 25 },
  be: { active: true, commissionPercent: 20 },
  direct: { active: true, commissionPercent: 0 },
};

export async function getDeliveryPlatformSettings(): Promise<DeliveryPlatformSettings> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !data) {
    return DEFAULT_DELIVERY_PLATFORM_SETTINGS;
  }
  const settings = (data.settings ?? {}) as Record<string, unknown>;
  const platforms = (settings.fnb_delivery_platforms ?? {}) as Partial<DeliveryPlatformSettings>;

  // Merge với default — nếu sàn nào chưa lưu, dùng default
  return {
    shopee_food: platforms.shopee_food ?? DEFAULT_DELIVERY_PLATFORM_SETTINGS.shopee_food,
    grab_food: platforms.grab_food ?? DEFAULT_DELIVERY_PLATFORM_SETTINGS.grab_food,
    gojek: platforms.gojek ?? DEFAULT_DELIVERY_PLATFORM_SETTINGS.gojek,
    be: platforms.be ?? DEFAULT_DELIVERY_PLATFORM_SETTINGS.be,
    direct: platforms.direct ?? DEFAULT_DELIVERY_PLATFORM_SETTINGS.direct,
  };
}

export async function updateDeliveryPlatformSettings(
  patch: Partial<DeliveryPlatformSettings>,
): Promise<void> {
  const supabase = getClient();
  const { error } = await (supabase.rpc as any)(
    "patch_tenant_settings_atomic",
    {
      p_section: "fnb_delivery_platforms",
      p_value: patch,
      p_replace: false,
    },
  );
  if (error) handleError(error, "updateDeliveryPlatformSettings");
}

// ============================================================
// Discount presets (Khuyến mãi nhanh)
// ============================================================

export interface DiscountPreset {
  id: string;
  name: string;
  mode: "amount" | "percent";
  /** Nếu mode=amount: VND. Nếu mode=percent: 0-100. */
  value: number;
  active: boolean;
}

export async function getDiscountPresets(): Promise<DiscountPreset[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !data) return [];

  const settings = (data.settings ?? {}) as Record<string, unknown>;
  const presets = (settings.fnb_discount_presets ?? []) as DiscountPreset[];
  return Array.isArray(presets) ? presets.filter((p) => p.active !== false) : [];
}

export async function saveDiscountPresets(
  presets: DiscountPreset[],
): Promise<void> {
  const supabase = getClient();
  const { error } = await (supabase.rpc as any)(
    "patch_tenant_settings_atomic",
    {
      p_section: "fnb_discount_presets",
      p_value: presets,
      p_replace: true,
    },
  );
  if (error) handleError(error, "saveDiscountPresets");
}
