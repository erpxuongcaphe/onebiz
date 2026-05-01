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
    invoiceFooter: updates.invoice_footer as string | undefined,
  };
}
