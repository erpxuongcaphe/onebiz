/**
 * Tenant Settings Service
 *
 * Lưu thông tin doanh nghiệp (business info) cần thiết cho hóa đơn VAT,
 * print template, phân tích branding.
 *
 * Schema: tenants.settings (jsonb) — không cần migration mới.
 *
 * Sprint HT-2: trước đây trang /he-thong/thiet-lap là placeholder vỏ rỗng
 * → in hóa đơn không có MST, địa chỉ pháp lý → vi phạm quy định kế toán.
 */

import { getClient, getCurrentTenantId, handleError } from "./base";
import { recordAuditLog } from "./audit";

export interface TenantBusinessInfo {
  /** Tên giao dịch / tên trên hóa đơn (khác tenant.name là tên hệ thống). */
  businessName?: string;
  /** Mã số thuế. */
  taxCode?: string;
  /** Địa chỉ kinh doanh (in trên hóa đơn). */
  address?: string;
  /** Số điện thoại liên hệ. */
  phone?: string;
  /** Email công ty. */
  email?: string;
  /** Website. */
  website?: string;
  /** URL logo (Supabase Storage public URL). Hiển thị header hóa đơn. */
  logoUrl?: string;
  /** Số tài khoản ngân hàng + tên ngân hàng (cho hóa đơn convertible). */
  bankAccount?: string;
  bankName?: string;
  /**
   * CEO 14/05: thêm BIN code (NAPAS 6 chữ số) + tên chủ TK cho VietQR auto.
   * BIN bắt buộc để build QR string; bankName là fallback cho UI cũ.
   */
  bankBin?: string;
  bankCode?: string;
  bankHolder?: string;
  /** Bật tự động in QR VietQR trên bill thanh toán (POS FnB + Retail). */
  vietQrEnabled?: boolean;
  /** Footer hóa đơn (chính sách đổi/trả, ghi chú cảm ơn,...). */
  invoiceFooter?: string;
}

/**
 * Đọc thông tin doanh nghiệp của tenant hiện tại.
 *
 * Trả về object empty nếu chưa có settings — UI hiển thị form trống.
 */
export async function getTenantBusinessInfo(): Promise<TenantBusinessInfo> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    console.warn("[getTenantBusinessInfo]", error.message);
    return {};
  }
  // tenants.settings là jsonb — read sub-key business_info nếu có.
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const business = (settings.business_info ?? {}) as Record<string, unknown>;
  return {
    businessName: business.business_name as string | undefined,
    taxCode: business.tax_code as string | undefined,
    address: business.address as string | undefined,
    phone: business.phone as string | undefined,
    email: business.email as string | undefined,
    website: business.website as string | undefined,
    logoUrl: business.logo_url as string | undefined,
    bankAccount: business.bank_account as string | undefined,
    bankName: business.bank_name as string | undefined,
    bankBin: business.bank_bin as string | undefined,
    bankCode: business.bank_code as string | undefined,
    bankHolder: business.bank_holder as string | undefined,
    vietQrEnabled: business.vietqr_enabled as boolean | undefined,
    invoiceFooter: business.invoice_footer as string | undefined,
  };
}

/**
 * Cập nhật thông tin doanh nghiệp.
 *
 * Merge vào `tenants.settings.business_info`, KHÔNG ghi đè các sub-key
 * khác (branding, language, ...) nếu sau này thêm.
 */
export async function updateTenantBusinessInfo(
  patch: Partial<TenantBusinessInfo>,
): Promise<TenantBusinessInfo> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Read current full settings để merge
  const { data: current, error: readErr } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", tenantId)
    .single();
  if (readErr) handleError(readErr, "updateTenantBusinessInfo.read");

  const currentSettings =
    (current?.settings as Record<string, unknown> | null) ?? {};
  const currentBusiness =
    (currentSettings.business_info as Record<string, unknown> | undefined) ?? {};

  // Map camelCase → snake_case cho DB jsonb
  const updates: Record<string, unknown> = { ...currentBusiness };
  if (patch.businessName !== undefined) updates.business_name = patch.businessName;
  if (patch.taxCode !== undefined) updates.tax_code = patch.taxCode;
  if (patch.address !== undefined) updates.address = patch.address;
  if (patch.phone !== undefined) updates.phone = patch.phone;
  if (patch.email !== undefined) updates.email = patch.email;
  if (patch.website !== undefined) updates.website = patch.website;
  if (patch.logoUrl !== undefined) updates.logo_url = patch.logoUrl;
  if (patch.bankAccount !== undefined) updates.bank_account = patch.bankAccount;
  if (patch.bankName !== undefined) updates.bank_name = patch.bankName;
  if (patch.bankBin !== undefined) updates.bank_bin = patch.bankBin;
  if (patch.bankCode !== undefined) updates.bank_code = patch.bankCode;
  if (patch.bankHolder !== undefined) updates.bank_holder = patch.bankHolder;
  if (patch.vietQrEnabled !== undefined) updates.vietqr_enabled = patch.vietQrEnabled;
  if (patch.invoiceFooter !== undefined) updates.invoice_footer = patch.invoiceFooter;

  const newSettings = {
    ...currentSettings,
    business_info: updates,
  };

  const { error: updErr } = await supabase
    .from("tenants")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ settings: newSettings as any, updated_at: new Date().toISOString() })
    .eq("id", tenantId);
  if (updErr) handleError(updErr, "updateTenantBusinessInfo.update");

  // Audit log: thay đổi thông tin pháp lý doanh nghiệp là quan trọng,
  // CEO cần trace ai sửa MST/tên/địa chỉ.
  await recordAuditLog({
    entityType: "tenant",
    entityId: tenantId,
    action: "update",
    oldData: currentBusiness,
    newData: updates,
  });

  return {
    businessName: updates.business_name as string | undefined,
    taxCode: updates.tax_code as string | undefined,
    address: updates.address as string | undefined,
    phone: updates.phone as string | undefined,
    email: updates.email as string | undefined,
    website: updates.website as string | undefined,
    logoUrl: updates.logo_url as string | undefined,
    bankAccount: updates.bank_account as string | undefined,
    bankName: updates.bank_name as string | undefined,
    bankBin: updates.bank_bin as string | undefined,
    bankCode: updates.bank_code as string | undefined,
    bankHolder: updates.bank_holder as string | undefined,
    vietQrEnabled: updates.vietqr_enabled as boolean | undefined,
    invoiceFooter: updates.invoice_footer as string | undefined,
  };
}

// ============================================================
// Day 18/05/2026 (CEO): Key-value settings table (migration 00095)
// Phục vụ các flag config: allow_negative_stock, require_bom_for_sku,...
// Khác với business_info ở trên — settings này lưu vào table tenant_settings
// riêng (không phải tenants.settings jsonb).
// ============================================================

export type SettingValue =
  | boolean
  | string
  | number
  | Record<string, unknown>
  | null;

export interface TenantSettingRow {
  key: string;
  value: SettingValue;
  description?: string;
  updatedAt?: string;
}

/**
 * Lấy 1 setting của tenant hiện tại. Trả về defaultValue nếu chưa có row.
 */
export async function getTenantSetting<T extends SettingValue>(
  key: string,
  defaultValue: T,
): Promise<T> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("tenant_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("key", key)
    .maybeSingle();

  if (error) {
    // Schema chưa apply hoặc lỗi mạng → trả default thay vì throw
    // để UI vẫn render được.
    console.warn("[getTenantSetting] fallback default:", error.message);
    return defaultValue;
  }

  if (!data) return defaultValue;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data as any).value as T) ?? defaultValue;
}

/**
 * Set 1 setting — gọi RPC `set_tenant_setting` (server check role owner/admin).
 */
export async function setTenantSetting(
  key: string,
  value: SettingValue,
  description?: string,
): Promise<void> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("set_tenant_setting", {
    p_key: key,
    p_value: value,
    p_description: description ?? null,
  });

  if (error) handleError(error, "setTenantSetting");

  if (!data || !(data as { success?: boolean }).success) {
    throw new Error("Không cập nhật được cài đặt.");
  }
}

/**
 * Lấy tất cả settings (cho trang cài đặt hệ thống).
 */
export async function listTenantSettings(): Promise<TenantSettingRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("tenant_settings")
    .select("key, value, description, updated_at")
    .eq("tenant_id", tenantId)
    .order("key");

  if (error) handleError(error, "listTenantSettings");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((row) => ({
    key: row.key as string,
    value: row.value as SettingValue,
    description: (row.description as string) ?? undefined,
    updatedAt: (row.updated_at as string) ?? undefined,
  }));
}

// ─── Typed wrappers cho các setting hay dùng ───

/** Cho phép bán SKU có BOM kể cả khi NVL không đủ tồn. Default: true */
export async function isAllowNegativeStock(): Promise<boolean> {
  const v = await getTenantSetting<SettingValue>(
    "allow_negative_stock",
    true as SettingValue,
  );
  return Boolean(v);
}

export async function setAllowNegativeStock(value: boolean): Promise<void> {
  return setTenantSetting(
    "allow_negative_stock",
    value,
    "Cho phép bán SKU có BOM kể cả khi NVL không đủ tồn (admin tự cân đối kế toán)",
  );
}

/** Bắt buộc SKU phải có BOM trước khi cho phép bán. Default: false */
export async function isRequireBomForSku(): Promise<boolean> {
  const v = await getTenantSetting<SettingValue>(
    "require_bom_for_sku",
    false as SettingValue,
  );
  return Boolean(v);
}

export async function setRequireBomForSku(value: boolean): Promise<void> {
  return setTenantSetting(
    "require_bom_for_sku",
    value,
    "Bắt buộc SKU phải có BOM trước khi cho phép bán (true = reject; false = chỉ cảnh báo)",
  );
}
