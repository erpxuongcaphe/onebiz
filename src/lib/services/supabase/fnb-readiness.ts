import { getClient } from "./base";
import {
  CHE_DO_TOPPING_SKU,
  TIEN_TO_SKU_TOPPING,
  locToppingHopLe,
  type DongBom,
} from "./fnb-toppings";

interface SanPhamTopping {
  id: string;
  code: string;
  name: string;
  sell_price: number | null;
  bom_code: string | null;
}

interface NhomTuyChon {
  id: string;
  rule: string;
}

interface LuaChonTuyChon {
  group_id: string;
  is_default: boolean;
  scale_factor: number | null;
  linked_product_id: string | null;
}

export interface FnbReadiness {
  toppingTotal: number;
  toppingReady: number;
  toppingMissingPrice: number;
  toppingMissingBom: number;
  singleGroupsWithManyDefaults: number;
  conflictingStockOptions: number;
  legacyToppingGroups: number;
  toppingSkuEnabled: boolean;
}

function coBomApDung(
  product: SanPhamTopping,
  boms: readonly DongBom[],
  branchId: string | null | undefined,
): boolean {
  const dungChiNhanh = (bom: DongBom) =>
    bom.branch_id === null || (!!branchId && bom.branch_id === branchId);

  if (product.bom_code) {
    return boms.some(
      (bom) => bom.code === product.bom_code && dungChiNhanh(bom),
    );
  }
  return boms.some((bom) => bom.product_id === product.id && dungChiNhanh(bom));
}

/** Lõi thuần để khóa cách tính bằng test, không ghi hoặc sửa dữ liệu. */
export function danhGiaFnbReadiness(input: {
  products: SanPhamTopping[];
  boms: DongBom[];
  groups: NhomTuyChon[];
  options: LuaChonTuyChon[];
  branchId?: string | null;
  toppingSkuEnabled?: boolean;
}): FnbReadiness {
  const optionsByGroup = new Map<string, LuaChonTuyChon[]>();
  for (const option of input.options) {
    const current = optionsByGroup.get(option.group_id) ?? [];
    current.push(option);
    optionsByGroup.set(option.group_id, current);
  }

  const toppingReady = locToppingHopLe(
    input.products,
    input.boms,
    input.branchId,
  ).length;

  return {
    toppingTotal: input.products.length,
    toppingReady,
    toppingMissingPrice: input.products.filter(
      (product) => (product.sell_price ?? 0) <= 0,
    ).length,
    toppingMissingBom: input.products.filter(
      (product) => !coBomApDung(product, input.boms, input.branchId),
    ).length,
    singleGroupsWithManyDefaults: input.groups.filter((group) => {
      if (group.rule === "multi") return false;
      return (
        (optionsByGroup.get(group.id) ?? []).filter(
          (option) => option.is_default,
        ).length > 1
      );
    }).length,
    conflictingStockOptions: input.options.filter(
      (option) => option.scale_factor !== null && !!option.linked_product_id,
    ).length,
    legacyToppingGroups: input.groups.filter((group) => {
      if (group.rule !== "multi") return false;
      return (optionsByGroup.get(group.id) ?? []).some(
        (option) => !!option.linked_product_id,
      );
    }).length,
    toppingSkuEnabled: input.toppingSkuEnabled ?? CHE_DO_TOPPING_SKU,
  };
}

/**
 * Đọc nhanh mức sẵn sàng vận hành FnB của đúng tenant và chi nhánh.
 * Chỉ SELECT; RLS và tenant filter vẫn áp dụng như các màn quản trị hiện có.
 */
export async function getFnbReadiness(
  tenantId: string,
  branchId: string | null | undefined,
): Promise<FnbReadiness> {
  const supabase = getClient();

  const [productsResult, groupsResult] = await Promise.all([
    supabase
      .from("products")
      .select("id, code, name, sell_price, bom_code")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .eq("product_type", "sku")
      .eq("channel", "fnb")
      .ilike("code", `${TIEN_TO_SKU_TOPPING}%`)
      .order("code")
      .limit(500),
    supabase
      .from("modifier_groups")
      .select("id, rule")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .in("channel", ["fnb", "all"])
      .limit(200),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (groupsResult.error) throw groupsResult.error;

  const products = (productsResult.data ?? []) as unknown as SanPhamTopping[];
  const groups = (groupsResult.data ?? []) as unknown as NhomTuyChon[];
  const productIds = products.map((product) => product.id);
  const bomCodes = products
    .map((product) => product.bom_code)
    .filter((code): code is string => !!code);
  const groupIds = groups.map((group) => group.id);

  const bomsPromise = productIds.length
    ? (() => {
        let query = supabase
          .from("bom")
          .select("product_id, code, branch_id")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .or(
            bomCodes.length
              ? `product_id.in.(${productIds.join(",")}),code.in.(${bomCodes.map((code) => `"${code}"`).join(",")})`
              : `product_id.in.(${productIds.join(",")})`,
          );
        query = branchId
          ? query.or(`branch_id.eq.${branchId},branch_id.is.null`)
          : query.is("branch_id", null);
        return query;
      })()
    : Promise.resolve({ data: [], error: null });

  const optionsPromise = groupIds.length
    ? supabase
        .from("modifier_options")
        .select("group_id, is_default, scale_factor, linked_product_id")
        .in("group_id", groupIds)
        .eq("is_active", true)
        .limit(1000)
    : Promise.resolve({ data: [], error: null });

  const [bomsResult, optionsResult] = await Promise.all([
    bomsPromise,
    optionsPromise,
  ]);
  if (bomsResult.error) throw bomsResult.error;
  if (optionsResult.error) throw optionsResult.error;

  return danhGiaFnbReadiness({
    products,
    boms: (bomsResult.data ?? []) as unknown as DongBom[],
    groups,
    options: (optionsResult.data ?? []) as unknown as LuaChonTuyChon[],
    branchId,
  });
}
