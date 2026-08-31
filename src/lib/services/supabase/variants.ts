// Packaging variants service — CRUD for product_variants
//
// Multi-tenant safety: filter tenant_id mọi query đọc + insert dùng
// getCurrentTenantId() thay vì hardcode "".

import { getClient, getCurrentTenantId } from "./base";
import type { ProductVariant } from "@/lib/types";

const supabase = getClient();

export interface FnbSizeSetupItemInput {
  materialId: string;
  inputQuantity: number;
  inputUnit: string;
  modifierScaleTarget?: string | null;
}

export interface FnbSizeSetupExactInput {
  materialId: string;
  modifierOptionId: string;
  inputQuantity: number;
  inputUnit: string;
}

export interface FnbSizeSetupVariantInput {
  clientKey: string;
  id?: string;
  name: string;
  sellPrice: number;
  costPrice: number;
  isDefault: boolean;
  sortOrder: number;
  bomCode: string;
  bomName: string;
  items: FnbSizeSetupItemInput[];
  exactRows: FnbSizeSetupExactInput[];
}

export interface SavedFnbSizeSetupVariant {
  clientKey: string;
  id: string;
  bomCode: string;
}

export interface AtomicFnbProductInput {
  code: string;
  name: string;
  categoryId: string;
  unit: string;
  purchaseUnit?: string;
  stockUnit?: string;
  sellUnit?: string;
  sellPrice: number;
  costPrice: number;
  minStock?: number;
  maxStock?: number;
  vatRate?: number;
  barcode?: string;
  weight?: number;
  description?: string;
  image?: string;
  allowSale?: boolean;
  groupCode?: string;
  shelfLifeDays?: number;
  shelfLifeUnit?: string;
  supplierId?: string;
  brand?: string;
  bomCode?: string;
}

export interface AtomicFnbProductResult {
  productId: string;
  code: string;
  variants: SavedFnbSizeSetupVariant[];
}

async function requireTenantProduct(productId: string, tenantId: string): Promise<void> {
  const { data, error } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Không tìm thấy sản phẩm trong công ty hiện tại.");
}

export async function getVariantsByProduct(
  productId: string
): Promise<ProductVariant[]> {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("product_variants")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw error;
  return (data ?? []).map(mapVariant);
}

/**
 * Batch fetch variants cho nhiều SP trong 1 request.
 * Dùng ở POS FnB init để warm cache — user click SP lần đầu thấy
 * dialog mở instant (không phải chờ 200-400ms round-trip).
 *
 * Return: Map<productId, variants[]> để caller populate cache Map<string, ...>.
 */
export async function getVariantsByProductIds(
  productIds: string[]
): Promise<Map<string, ProductVariant[]>> {
  const result = new Map<string, ProductVariant[]>();
  if (productIds.length === 0) return result;

  const tenantId = await getCurrentTenantId();
  // Dedup + limit để tránh query quá lớn (Postgres IN giới hạn ~thousands, nhưng
  // POS menu thường <500 SP nên ok. Vẫn cắt 500 cho an toàn).
  const unique = Array.from(new Set(productIds)).slice(0, 500);

  const { data, error } = await supabase
    .from("product_variants")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("product_id", unique)
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw error;

  for (const row of data ?? []) {
    const pid = row.product_id as string;
    const list = result.get(pid) ?? [];
    list.push(mapVariant(row));
    result.set(pid, list);
  }
  return result;
}

export async function createVariant(variant: {
  productId: string;
  name: string;
  sku?: string;
  packagingType?: string;
  packagingSize?: string;
  unitCount?: number;
  barcode?: string;
  sellPrice: number;
  costPrice: number;
  weight?: number;
  isDefault?: boolean;
  sortOrder?: number;
  /** Sprint 2.4a: mã BOM riêng cho variant (vd "CFS-002-M") */
  bomCode?: string | null;
}): Promise<ProductVariant> {
  const tenantId = await getCurrentTenantId();
  await requireTenantProduct(variant.productId, tenantId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("product_variants").insert as any)({
    tenant_id: tenantId,
    product_id: variant.productId,
    name: variant.name,
    sku: variant.sku ?? null,
    packaging_type: variant.packagingType ?? null,
    packaging_size: variant.packagingSize ?? null,
    unit_count: variant.unitCount ?? 1,
    barcode: variant.barcode ?? null,
    sell_price: variant.sellPrice,
    cost_price: variant.costPrice,
    weight: variant.weight ?? null,
    is_default: variant.isDefault ?? false,
    sort_order: variant.sortOrder ?? 0,
    bom_code: variant.bomCode ?? null,
  })
    .select()
    .single();

  if (error) throw error;
  return mapVariant(data);
}

export async function updateVariant(
  id: string,
  updates: Partial<{
    name: string;
    sku: string;
    packagingType: string;
    packagingSize: string;
    unitCount: number;
    barcode: string;
    sellPrice: number;
    costPrice: number;
    weight: number;
    isDefault: boolean;
    isActive: boolean;
    sortOrder: number;
    /** Sprint 2.4a */
    bomCode: string | null;
  }>
) {
  const tenantId = await getCurrentTenantId();
  const updateObj: Record<string, unknown> = {};
  if (updates.name !== undefined) updateObj.name = updates.name;
  if (updates.sku !== undefined) updateObj.sku = updates.sku;
  if (updates.packagingType !== undefined) updateObj.packaging_type = updates.packagingType;
  if (updates.packagingSize !== undefined) updateObj.packaging_size = updates.packagingSize;
  if (updates.unitCount !== undefined) updateObj.unit_count = updates.unitCount;
  if (updates.barcode !== undefined) updateObj.barcode = updates.barcode;
  if (updates.sellPrice !== undefined) updateObj.sell_price = updates.sellPrice;
  if (updates.costPrice !== undefined) updateObj.cost_price = updates.costPrice;
  if (updates.weight !== undefined) updateObj.weight = updates.weight;
  if (updates.isDefault !== undefined) updateObj.is_default = updates.isDefault;
  if (updates.isActive !== undefined) updateObj.is_active = updates.isActive;
  if (updates.sortOrder !== undefined) updateObj.sort_order = updates.sortOrder;
  if (updates.bomCode !== undefined) updateObj.bom_code = updates.bomCode;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("product_variants").update as any)(updateObj)
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) throw error;
}

export async function deleteVariant(id: string) {
  const tenantId = await getCurrentTenantId();
  const { error } = await supabase
    .from("product_variants")
    .update({ is_active: false })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) throw error;
}

/** 00357: replace the complete FnB size setup in one server transaction. */
export async function saveFnbSizeSetupAtomic(
  productId: string,
  variants: FnbSizeSetupVariantInput[],
): Promise<SavedFnbSizeSetupVariant[]> {
  if (!productId) throw new Error("Sản phẩm không hợp lệ.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(
    "save_fnb_size_setup_atomic",
    { p_product_id: productId, p_variants: variants },
  );
  if (error) {
    const detail = [error.message, error.details, error.hint]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" | ");
    throw new Error(detail || "Máy chủ không thể lưu quy cách FnB.");
  }

  let payload: unknown = data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      throw new Error("Máy chủ trả kết quả lưu quy cách không hợp lệ.");
    }
  }
  const result = payload as
    | { success?: boolean; variants?: Array<Record<string, unknown>> }
    | null;
  const rows = Array.isArray(result?.variants) ? result.variants : [];
  const saved = rows.map((row: Record<string, unknown>) => ({
    clientKey: String(row.clientKey ?? ""),
    id: String(row.id ?? ""),
    bomCode: String(row.bomCode ?? ""),
  }));

  const expectedKeys = new Set(variants.map((variant) => variant.clientKey));
  const responseMatchesRequest =
    result?.success === true &&
    saved.length === variants.length &&
    saved.every(
      (row) => row.id && row.bomCode && expectedKeys.has(row.clientKey),
    );
  if (!responseMatchesRequest) {
    throw new Error(
      "Máy chủ chưa xác nhận đủ quy cách FnB. Dữ liệu vẫn được giữ để thử lưu lại.",
    );
  }

  // Never let the dialog report success from the RPC response alone. Read the
  // active rows back through the normal tenant-scoped path before clearing the
  // operator's draft; this catches a stale schema or an unexpected rollback.
  const confirmed = await getVariantsByProduct(productId);
  const confirmedIds = new Set(confirmed.map((variant) => variant.id));
  if (
    confirmed.length !== variants.length ||
    saved.some((row) => !confirmedIds.has(row.id))
  ) {
    throw new Error(
      "Máy chủ chưa lưu đủ quy cách FnB. Dữ liệu vẫn được giữ để thử lưu lại.",
    );
  }

  return saved;
}

/** 00365: create the parent FnB SKU and complete size setup in one transaction. */
export async function createFnbProductWithSizeSetupAtomic(
  product: AtomicFnbProductInput,
  variants: FnbSizeSetupVariantInput[],
  modifierGroupIds: string[],
): Promise<AtomicFnbProductResult> {
  if (!product.code || !product.name || !product.categoryId) {
    throw new Error("Thiếu thông tin bắt buộc của sản phẩm FnB.");
  }
  if (variants.length === 0) {
    throw new Error("Món có quy cách phải có ít nhất một size.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(
    "create_fnb_product_with_size_setup_atomic",
    {
      p_product: product,
      p_variants: variants,
      p_modifier_group_ids: modifierGroupIds,
    },
  );
  if (error) throw error;
  if (!data?.productId || !data?.code) {
    throw new Error("Máy chủ không trả kết quả tạo sản phẩm FnB hợp lệ.");
  }

  return {
    productId: String(data.productId),
    code: String(data.code),
    variants: (Array.isArray(data.variants) ? data.variants : []).map(
      (row: Record<string, unknown>) => ({
        clientKey: String(row.clientKey ?? ""),
        id: String(row.id ?? ""),
        bomCode: String(row.bomCode ?? ""),
      }),
    ),
  };
}

function mapVariant(row: Record<string, unknown>): ProductVariant {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    productId: row.product_id as string,
    sku: (row.sku as string) ?? undefined,
    name: row.name as string,
    packagingType: (row.packaging_type as string) ?? undefined,
    packagingSize: (row.packaging_size as string) ?? undefined,
    unitCount: (row.unit_count as number) ?? 1,
    barcode: (row.barcode as string) ?? undefined,
    sellPrice: (row.sell_price as number) ?? 0,
    costPrice: (row.cost_price as number) ?? 0,
    weight: (row.weight as number) ?? undefined,
    isDefault: (row.is_default as boolean) ?? false,
    isActive: (row.is_active as boolean) ?? true,
    sortOrder: (row.sort_order as number) ?? 0,
    bomCode: (row.bom_code as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
