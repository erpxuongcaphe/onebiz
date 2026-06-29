// Print Template Engine (Cài đặt In V3 — GĐ3)
// CEO 25/06/2026: mỗi (Mảng × Loại chứng từ × Chi nhánh) có mẫu in riêng,
// kế thừa Thương hiệu chung, ghi đè khi cần. Plan: docs/PLAN-CAI-DAT-IN-V3.md
//
// ADDITIVE: resolvePrintTemplate trả null khi chưa có mẫu → caller dùng builder
// built-in như cũ (zero-regression).
//
// Bảng print_templates + branches.print_brand chưa nằm trong type generated →
// dùng (supabase as any) để né type cũ (regen sau).

import { getClient, getCurrentTenantId } from "./base";
import { getTenantBusinessInfo } from "./tenant-settings";

const supabase = getClient();

// ── Types ──────────────────────────────────────────────────
export type PrintChannel = "retail" | "wholesale" | "fnb" | "backoffice";

export type PrintDocType =
  | "sale_invoice"
  | "sales_order"
  | "sale_return"
  | "kitchen_ticket"
  | "purchase_order"
  | "goods_receipt"
  | "input_invoice"
  | "purchase_return"
  | "internal_sale"
  | "internal_export"
  | "inventory_check"
  | "disposal"
  | "production_order"
  | "cash_voucher";

export type PrintPaperSize = "58mm" | "80mm" | "A5" | "A4";

export interface PrintTemplateConfig {
  /** Override tiêu đề (cho phép token) */
  title?: string;
  header?: {
    logo?: boolean;
    businessName?: boolean;
    taxCode?: boolean;
    address?: boolean;
    branch?: boolean;
    phone?: boolean;
  };
  customer?: { name?: boolean; code?: boolean; phone?: boolean; address?: boolean };
  items?: { fontSize?: "sm" | "md" | "lg"; columns?: string[] };
  payment?: { showQr?: boolean; showDiscount?: boolean; showDebt?: boolean };
  footer?: { signature?: boolean; thankYou?: boolean; customText?: string };
}

export interface PrintTemplate {
  id: string;
  tenantId: string;
  channel: PrintChannel;
  docType: PrintDocType;
  /** null = mặc định cho mọi chi nhánh của kênh */
  branchId: string | null;
  name: string;
  paperSize: PrintPaperSize;
  config: PrintTemplateConfig;
  isDefault: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Thương hiệu chung đã resolve (tenant ← branch override). */
export interface ResolvedBrand {
  logoUrl?: string;
  businessName?: string;
  taxCode?: string;
  address?: string;
  phone?: string;
  footer?: string;
  bankBin?: string;
  bankCode?: string;
  bankHolder?: string;
  /** Số tài khoản ngân hàng — cần để build URL QR thanh toán (VietQR). */
  bankAccount?: string;
  vietQrEnabled?: boolean;
}

export interface ResolvedPrint {
  template: PrintTemplate;
  paperSize: PrintPaperSize;
  config: PrintTemplateConfig;
  brand: ResolvedBrand;
}

function mapRow(r: Record<string, unknown>): PrintTemplate {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    channel: r.channel as PrintChannel,
    docType: r.doc_type as PrintDocType,
    branchId: (r.branch_id as string | null) ?? null,
    name: r.name as string,
    paperSize: (r.paper_size as PrintPaperSize) ?? "80mm",
    config: (r.config as PrintTemplateConfig) ?? {},
    isDefault: (r.is_default as boolean) ?? true,
    isActive: (r.is_active as boolean) ?? true,
    createdAt: r.created_at as string | undefined,
    updatedAt: r.updated_at as string | undefined,
  };
}

// ── CRUD ───────────────────────────────────────────────────
export async function listPrintTemplates(filter?: {
  channel?: PrintChannel;
  docType?: PrintDocType;
  branchId?: string | null;
}): Promise<PrintTemplate[]> {
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("print_templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (filter?.channel) q = q.eq("channel", filter.channel);
  if (filter?.docType) q = q.eq("doc_type", filter.docType);
  if (filter?.branchId === null) q = q.is("branch_id", null);
  else if (filter?.branchId) q = q.eq("branch_id", filter.branchId);
  const { data, error } = await q.order("doc_type").order("is_default", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

/** Mọi mẫu active của tenant — cho UI ma trận gán. */
export async function listTemplatesForMatrix(): Promise<PrintTemplate[]> {
  return listPrintTemplates();
}

export async function getPrintTemplate(id: string): Promise<PrintTemplate | null> {
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("print_templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

/** Gỡ cờ default của mọi mẫu cùng khóa (channel, docType, branch) trước khi set 1 mẫu default. */
async function unsetDefaultSiblings(
  tenantId: string,
  channel: PrintChannel,
  docType: PrintDocType,
  branchId: string | null,
  exceptId?: string
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("print_templates")
    .update({ is_default: false })
    .eq("tenant_id", tenantId)
    .eq("channel", channel)
    .eq("doc_type", docType)
    .eq("is_default", true);
  q = branchId === null ? q.is("branch_id", null) : q.eq("branch_id", branchId);
  if (exceptId) q = q.neq("id", exceptId);
  const { error } = await q;
  if (error) throw error;
}

export async function createPrintTemplate(input: {
  channel: PrintChannel;
  docType: PrintDocType;
  branchId?: string | null;
  name: string;
  paperSize?: PrintPaperSize;
  config?: PrintTemplateConfig;
  isDefault?: boolean;
}): Promise<PrintTemplate> {
  const tenantId = await getCurrentTenantId();
  const branchId = input.branchId ?? null;
  const isDefault = input.isDefault ?? true;
  // Né vi phạm unique partial (1 default/khóa): gỡ default cũ trước.
  if (isDefault) {
    await unsetDefaultSiblings(tenantId, input.channel, input.docType, branchId);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("print_templates")
    .insert({
      tenant_id: tenantId,
      channel: input.channel,
      doc_type: input.docType,
      branch_id: branchId,
      name: input.name,
      paper_size: input.paperSize ?? "80mm",
      config: input.config ?? {},
      is_default: isDefault,
      is_active: true,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

export async function updatePrintTemplate(
  id: string,
  patch: Partial<{
    name: string;
    paperSize: PrintPaperSize;
    config: PrintTemplateConfig;
    isDefault: boolean;
  }>
): Promise<void> {
  const tenantId = await getCurrentTenantId();
  // Nếu set default → gỡ siblings trước (cần biết khóa).
  if (patch.isDefault === true) {
    const cur = await getPrintTemplate(id);
    if (cur) await unsetDefaultSiblings(tenantId, cur.channel, cur.docType, cur.branchId, id);
  }
  const upd: Record<string, unknown> = {};
  if (patch.name !== undefined) upd.name = patch.name;
  if (patch.paperSize !== undefined) upd.paper_size = patch.paperSize;
  if (patch.config !== undefined) upd.config = patch.config;
  if (patch.isDefault !== undefined) upd.is_default = patch.isDefault;
  if (Object.keys(upd).length === 0) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("print_templates")
    .update(upd)
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) throw error;
}

/** Đặt 1 mẫu làm mặc định cho khóa của nó (gỡ default mẫu khác cùng khóa). */
export async function setDefaultPrintTemplate(id: string): Promise<void> {
  await updatePrintTemplate(id, { isDefault: true });
}

/** Xoá mềm (is_active=false) — giữ lịch sử. */
export async function deletePrintTemplate(id: string): Promise<void> {
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("print_templates")
    .update({ is_active: false, is_default: false })
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) throw error;
}

/** Nhân bản 1 mẫu (mặc định non-default, có thể gán branch khác). */
export async function duplicatePrintTemplate(
  id: string,
  opts?: { branchId?: string | null; name?: string; asDefault?: boolean }
): Promise<PrintTemplate> {
  const src = await getPrintTemplate(id);
  if (!src) throw new Error("Không tìm thấy mẫu nguồn");
  return createPrintTemplate({
    channel: src.channel,
    docType: src.docType,
    branchId: opts?.branchId !== undefined ? opts.branchId : src.branchId,
    name: opts?.name ?? `${src.name} (bản sao)`,
    paperSize: src.paperSize,
    config: src.config,
    isDefault: opts?.asDefault ?? false,
  });
}

// ── Thương hiệu chung (brand) ──────────────────────────────
interface BranchPrintRecord {
  name?: string;
  address?: string;
  phone?: string;
  /** MST của chi nhánh (đơn vị phụ thuộc) — VN mỗi chi nhánh 1 MST riêng. */
  taxCode?: string;
  override: Partial<ResolvedBrand> | null;
}
/** Đọc hồ sơ chi nhánh: tên + địa chỉ + SĐT + MST THẬT + override print_brand. */
async function getBranchRecord(branchId: string): Promise<BranchPrintRecord | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("branches")
    .select("name, address, phone, legal_tax_code, print_brand")
    .eq("id", branchId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    name: (data.name as string) ?? undefined,
    address: (data.address as string) ?? undefined,
    phone: (data.phone as string) ?? undefined,
    taxCode: (data.legal_tax_code as string) ?? undefined,
    override: (data.print_brand as Partial<ResolvedBrand> | null) ?? null,
  };
}

/** Thông tin in của 1 chi nhánh — cho UI hiển thị/sửa (TẦNG chi nhánh). */
export interface BranchPrintInfo {
  /** Tên chi nhánh (từ hồ sơ chi nhánh). */
  branchName?: string;
  /** Địa chỉ sẽ IN ra (override print riêng ?? địa chỉ hồ sơ chi nhánh). */
  address?: string;
  /** SĐT sẽ in ra. */
  phone?: string;
  /** MST sẽ in ra (đơn vị phụ thuộc của chi nhánh). */
  taxCode?: string;
  /** Override in riêng (logo/QR/địa chỉ in khác hồ sơ) — null nếu chưa đặt. */
  override: Partial<ResolvedBrand> | null;
}
export async function getBranchPrintInfo(branchId: string): Promise<BranchPrintInfo> {
  const rec = await getBranchRecord(branchId);
  const ov = rec?.override ?? null;
  const ovAddr = ov?.address && ov.address !== "" ? ov.address : undefined;
  const ovPhone = ov?.phone && ov.phone !== "" ? ov.phone : undefined;
  const ovTax = ov?.taxCode && ov.taxCode !== "" ? ov.taxCode : undefined;
  return {
    branchName: rec?.name,
    address: ovAddr ?? rec?.address,
    phone: ovPhone ?? rec?.phone,
    taxCode: ovTax ?? rec?.taxCode,
    override: ov,
  };
}

/** Ghi override brand cho 1 chi nhánh (null = xoá override → kế thừa tenant). */
export async function setBranchPrintBrand(
  branchId: string,
  brand: Partial<ResolvedBrand> | null
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("branches")
    .update({ print_brand: brand })
    .eq("id", branchId);
  if (error) throw error;
}

/** Brand đã merge: tenant business_info ← branch.print_brand override. */
export async function getResolvedBrand(branchId?: string | null): Promise<ResolvedBrand> {
  const t = await getTenantBusinessInfo();
  const base: ResolvedBrand = {
    logoUrl: t.logoUrl,
    businessName: t.businessName,
    taxCode: t.taxCode,
    address: t.address,
    phone: t.phone,
    footer: t.invoiceFooter,
    bankBin: t.bankBin,
    bankCode: t.bankCode,
    bankHolder: t.bankHolder,
    bankAccount: t.bankAccount,
    vietQrEnabled: t.vietQrEnabled,
  };
  if (!branchId) return base;
  const rec = await getBranchRecord(branchId);
  if (!rec) return base;
  const merged: ResolvedBrand = { ...base };
  // Tầng chi nhánh: ĐỊA CHỈ + SĐT + MST thật của chi nhánh đè lên của công ty
  // (in ra đúng địa chỉ + MST đơn vị phụ thuộc của chi nhánh đang in — CEO 25/06).
  if (rec.address) merged.address = rec.address;
  if (rec.phone) merged.phone = rec.phone;
  if (rec.taxCode) merged.taxCode = rec.taxCode;
  // Override in riêng (print_brand) đè trên cùng: logo/QR/footer/địa chỉ in khác.
  if (rec.override) {
    for (const [k, v] of Object.entries(rec.override)) {
      if (v !== undefined && v !== null && v !== "") {
        (merged as Record<string, unknown>)[k] = v;
      }
    }
  }
  return merged;
}

// ── Resolver ───────────────────────────────────────────────
/**
 * Tìm mẫu in hiệu lực cho (channel, docType, branch).
 * Ưu tiên: mẫu default riêng branch → mẫu default global (branch=null) → null.
 * null = chưa cấu hình → caller dùng builder built-in (giữ luồng in cũ).
 */
export async function resolvePrintTemplate(
  channel: PrintChannel,
  docType: PrintDocType,
  branchId?: string | null
): Promise<ResolvedPrint | null> {
  const tenantId = await getCurrentTenantId();

  async function pick(branch: string | null): Promise<PrintTemplate | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from("print_templates")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("channel", channel)
      .eq("doc_type", docType)
      .eq("is_active", true)
      .eq("is_default", true);
    q = branch === null ? q.is("branch_id", null) : q.eq("branch_id", branch);
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as Record<string, unknown>) : null;
  }

  let tpl: PrintTemplate | null = null;
  if (branchId) tpl = await pick(branchId);
  if (!tpl) tpl = await pick(null);
  if (!tpl) return null;

  const brand = await getResolvedBrand(branchId);
  return { template: tpl, paperSize: tpl.paperSize, config: tpl.config, brand };
}
