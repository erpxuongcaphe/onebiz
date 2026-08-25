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
  has_bom?: boolean | null;
}

interface QuyCachFnb {
  id: string;
  product_id: string;
  name: string;
  sell_price: number | null;
  bom_code: string | null;
  is_default: boolean;
}

export interface FnbMenuIssue {
  id: string;
  code: string;
  name: string;
  variantName?: string;
  missingPrice: boolean;
  missingBom: boolean;
}

interface NhomTuyChon {
  id: string;
  name: string;
  rule: string;
}

interface LuaChonTuyChon {
  group_id: string;
  label: string;
  is_default: boolean;
  scale_factor: number | null;
  linked_product_id: string | null;
}

export interface FnbToppingIssue {
  id: string;
  code: string;
  name: string;
  missingPrice: boolean;
  missingBom: boolean;
}

export interface FnbConfigurationIssue {
  type: "many_defaults" | "stock_conflict" | "legacy_topping";
  groupName: string;
  optionLabel?: string;
}

export interface FnbReadiness {
  menuTotal: number;
  simpleProductsMissingPrice: number;
  simpleProductsMissingBom: number;
  variantsTotal: number;
  variantsMissingPrice: number;
  variantsMissingBom: number;
  variantProductsWithInvalidDefaults: number;
  activeKitchenStations: number;
  activeTables: number;
  menuIssues: FnbMenuIssue[];
  toppingTotal: number;
  toppingReady: number;
  toppingMissingPrice: number;
  toppingMissingBom: number;
  singleGroupsWithManyDefaults: number;
  conflictingStockOptions: number;
  legacyToppingGroups: number;
  toppingSkuEnabled: boolean;
  toppingIssues: FnbToppingIssue[];
  configurationIssues: FnbConfigurationIssue[];
}

function coBomApDung(
  product: Pick<SanPhamTopping, "id" | "bom_code">,
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
  menuProducts?: SanPhamTopping[];
  variants?: QuyCachFnb[];
  boms: DongBom[];
  groups: NhomTuyChon[];
  options: LuaChonTuyChon[];
  branchId?: string | null;
  toppingSkuEnabled?: boolean;
  activeKitchenStations?: number;
  activeTables?: number;
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
  const groupById = new Map(input.groups.map((group) => [group.id, group]));
  const toppingIssues = input.products
    .map((product) => ({
      id: product.id,
      code: product.code,
      name: product.name,
      missingPrice: (product.sell_price ?? 0) <= 0,
      missingBom: !coBomApDung(product, input.boms, input.branchId),
    }))
    .filter((product) => product.missingPrice || product.missingBom)
    .sort((a, b) => a.code.localeCompare(b.code, "vi"));

  const configurationIssues: FnbConfigurationIssue[] = [];
  for (const group of input.groups) {
    const options = optionsByGroup.get(group.id) ?? [];
    if (
      group.rule !== "multi" &&
      options.filter((option) => option.is_default).length > 1
    ) {
      configurationIssues.push({
        type: "many_defaults",
        groupName: group.name,
      });
    }
    if (
      group.rule === "multi" &&
      options.some((option) => !!option.linked_product_id)
    ) {
      configurationIssues.push({
        type: "legacy_topping",
        groupName: group.name,
      });
    }
  }
  for (const option of input.options) {
    if (option.scale_factor !== null && !!option.linked_product_id) {
      configurationIssues.push({
        type: "stock_conflict",
        groupName: groupById.get(option.group_id)?.name ?? "Nhóm không xác định",
        optionLabel: option.label,
      });
    }
  }

  const menuProducts = input.menuProducts ?? [];
  const variants = input.variants ?? [];
  const variantsByProductId = new Map<string, QuyCachFnb[]>();
  for (const variant of variants) {
    const current = variantsByProductId.get(variant.product_id) ?? [];
    current.push(variant);
    variantsByProductId.set(variant.product_id, current);
  }

  const simpleProducts = menuProducts.filter(
    (product) => (variantsByProductId.get(product.id) ?? []).length === 0,
  );
  const simpleProductsMissingPrice = simpleProducts.filter(
    (product) => (product.sell_price ?? 0) <= 0,
  );
  const simpleProductsMissingBom = simpleProducts.filter(
    (product) =>
      product.has_bom === true &&
      !coBomApDung(product, input.boms, input.branchId),
  );
  const variantsMissingPrice = variants.filter(
    (variant) => (variant.sell_price ?? 0) <= 0,
  );
  const variantsMissingBom = variants.filter(
    (variant) =>
      !variant.bom_code ||
      !input.boms.some(
        (bom) =>
          bom.code === variant.bom_code &&
          (bom.branch_id === null ||
            (!!input.branchId && bom.branch_id === input.branchId)),
      ),
  );
  const variantProductsWithInvalidDefaults = [...variantsByProductId.values()].filter(
    (productVariants) =>
      productVariants.filter((variant) => variant.is_default).length !== 1,
  );
  const menuById = new Map(menuProducts.map((product) => [product.id, product]));
  const variantIssueById = new Map<string, FnbMenuIssue>();
  for (const variant of variants) {
    const product = menuById.get(variant.product_id);
    if (!product) continue;
    const missingPrice = (variant.sell_price ?? 0) <= 0;
    const missingBom = variantsMissingBom.some((item) => item.id === variant.id);
    if (missingPrice || missingBom) {
      variantIssueById.set(variant.id, {
        id: variant.id,
        code: product.code,
        name: product.name,
        variantName: variant.name,
        missingPrice,
        missingBom,
      });
    }
  }
  const menuIssues: FnbMenuIssue[] = [
    ...simpleProducts
      .map((product) => ({
        id: product.id,
        code: product.code,
        name: product.name,
        missingPrice: (product.sell_price ?? 0) <= 0,
        missingBom:
          product.has_bom === true &&
          !coBomApDung(product, input.boms, input.branchId),
      }))
      .filter((product) => product.missingPrice || product.missingBom),
    ...variantIssueById.values(),
  ].sort((a, b) => a.code.localeCompare(b.code, "vi"));

  return {
    menuTotal: menuProducts.length,
    simpleProductsMissingPrice: simpleProductsMissingPrice.length,
    simpleProductsMissingBom: simpleProductsMissingBom.length,
    variantsTotal: variants.length,
    variantsMissingPrice: variantsMissingPrice.length,
    variantsMissingBom: variantsMissingBom.length,
    variantProductsWithInvalidDefaults: variantProductsWithInvalidDefaults.length,
    activeKitchenStations: input.activeKitchenStations ?? 0,
    activeTables: input.activeTables ?? 0,
    menuIssues,
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
    toppingIssues,
    configurationIssues,
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

  const [menuProductsResult, groupsResult] = await Promise.all([
    supabase
      .from("products")
      .select("id, code, name, sell_price, bom_code, has_bom")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .eq("product_type", "sku")
      .eq("channel", "fnb")
      .order("code")
      .limit(500),
    supabase
      .from("modifier_groups")
      .select("id, name, rule")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .in("channel", ["fnb", "all"])
      .limit(200),
  ]);
  if (menuProductsResult.error) throw menuProductsResult.error;
  if (groupsResult.error) throw groupsResult.error;

  const menuProducts = (menuProductsResult.data ?? []) as unknown as SanPhamTopping[];
  const products = menuProducts.filter((product) =>
    product.code.startsWith(TIEN_TO_SKU_TOPPING),
  );
  const groups = (groupsResult.data ?? []) as unknown as NhomTuyChon[];
  const productIds = menuProducts.map((product) => product.id);
  const productBomCodes = menuProducts
    .map((product) => product.bom_code)
    .filter((code): code is string => !!code);
  const groupIds = groups.map((group) => group.id);

  const variantsPromise = productIds.length
    ? (supabase as any)
        .from("product_variants")
        .select("id, product_id, name, sell_price, bom_code, is_default")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .in("product_id", productIds)
        .limit(1000)
    : Promise.resolve({ data: [], error: null });

  const [variantsResult, optionsResult, stationsResult, tablesResult] = await Promise.all([
    variantsPromise,
    groupIds.length
      ? supabase
          .from("modifier_options")
          .select("group_id, label, is_default, scale_factor, linked_product_id")
          .in("group_id", groupIds)
          .eq("is_active", true)
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    (supabase as any)
      .from("kitchen_stations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId ?? "")
      .eq("is_active", true),
    (supabase as any)
      .from("restaurant_tables")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId ?? "")
      .eq("is_active", true),
  ]);
  if (variantsResult.error) throw variantsResult.error;
  if (optionsResult.error) throw optionsResult.error;
  if (stationsResult.error) throw stationsResult.error;
  if (tablesResult.error) throw tablesResult.error;

  const variants = (variantsResult.data ?? []) as QuyCachFnb[];
  const bomCodes = [
    ...productBomCodes,
    ...variants
      .map((variant) => variant.bom_code)
      .filter((code): code is string => !!code),
  ];
  const uniqueBomCodes = [...new Set(bomCodes)];

  const bomsPromise = productIds.length
    ? (() => {
        let query = supabase
          .from("bom")
          .select("product_id, code, branch_id")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .or(
            uniqueBomCodes.length
              ? `product_id.in.(${productIds.join(",")}),code.in.(${uniqueBomCodes.map((code) => `"${code}"`).join(",")})`
              : `product_id.in.(${productIds.join(",")})`,
          );
        query = branchId
          ? query.or(`branch_id.eq.${branchId},branch_id.is.null`)
          : query.is("branch_id", null);
        return query;
      })()
    : Promise.resolve({ data: [], error: null });

  const bomsResult = await bomsPromise;
  if (bomsResult.error) throw bomsResult.error;

  return danhGiaFnbReadiness({
    products,
    menuProducts,
    variants,
    boms: (bomsResult.data ?? []) as unknown as DongBom[],
    groups,
    options: (optionsResult.data ?? []) as unknown as LuaChonTuyChon[],
    branchId,
    activeKitchenStations: stationsResult.count ?? 0,
    activeTables: tablesResult.count ?? 0,
  });
}
