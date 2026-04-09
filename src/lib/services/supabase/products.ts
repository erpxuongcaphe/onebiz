/**
 * Supabase service: Products & Categories
 */

import type { Product, ProductDetail, StockMovement, SalesHistory, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { getClient, getPaginationRange, handleError } from "./base";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

// --- Products ---

export async function getProducts(params: QueryParams): Promise<QueryResult<Product>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("products")
    .select("*, categories!products_category_id_fkey(name)", { count: "exact" });

  // Search
  if (params.search) {
    query = query.or(`name.ilike.%${params.search}%,code.ilike.%${params.search}%`);
  }

  // Filter: product_type (nvl | sku)
  if (params.filters?.productType && params.filters.productType !== "all") {
    query = query.eq("product_type", params.filters.productType as string);
  }

  // Filter: category
  if (params.filters?.category && params.filters.category !== "all") {
    const cats = Array.isArray(params.filters.category)
      ? params.filters.category
      : [params.filters.category];
    query = query.in("category_id", cats);
  }

  // Filter: stock
  if (params.filters?.stock) {
    const stockFilter = params.filters.stock as string;
    if (stockFilter === "in_stock") query = query.gt("stock", 0);
    else if (stockFilter === "out_of_stock") query = query.eq("stock", 0);
    else if (stockFilter === "low_stock") query = query.gt("stock", 0).lte("stock", 5);
  }

  // Filter: status (active | inactive) — map sang cột is_active boolean
  if (params.filters?.status && params.filters.status !== "all") {
    const isActive = params.filters.status === "active";
    query = query.eq("is_active", isActive);
  }

  // Sort
  const sortBy = params.sortBy ?? "created_at";
  const ascending = params.sortOrder === "asc";
  query = query.order(sortBy, { ascending });

  // Paginate
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getProducts");

  const products: Product[] = (data ?? []).map((row) => mapProduct(row));

  return { data: products, total: count ?? 0 };
}

/**
 * Get product categories synchronously (empty fallback).
 * Used at module level where async isn't possible.
 * For real data, use getProductCategoriesAsync().
 */
export function getProductCategories() {
  return [] as { label: string; value: string; count: number }[];
}

/**
 * Get product categories from DB (async).
 */
export async function getProductCategoriesAsync(scope?: "nvl" | "sku") {
  const supabase = getClient();

  let catQuery = supabase
    .from("categories")
    .select("id, name, code, scope")
    .order("sort_order", { ascending: true });

  if (scope) catQuery = catQuery.eq("scope", scope);

  const { data: categories, error } = await catQuery;
  if (error) handleError(error, "getProductCategoriesAsync");

  // Get counts per category (filter by product_type if scope set)
  let prodQuery = supabase.from("products").select("category_id, product_type");
  if (scope) prodQuery = prodQuery.eq("product_type", scope);
  const { data: products } = await prodQuery;

  return (categories ?? []).map((cat) => ({
    label: cat.name,
    value: cat.id,
    code: cat.code ?? undefined,
    count: (products ?? []).filter((p) => p.category_id === cat.id).length,
  }));
}

export async function getProductById(id: string): Promise<ProductDetail | null> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("products")
    .select("*, categories!products_category_id_fkey(name)")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    handleError(error, "getProductById");
  }
  if (!data) return null;

  // TODO: Query price_books + product_prices when types are generated
  // For now, return empty price books
  return mapProductDetail(data, []);
}

// --- Stock Movements ---

export async function getStockMovements(
  productId: string,
  params: QueryParams
): Promise<QueryResult<StockMovement>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  const { data, count, error } = await supabase
    .from("stock_movements")
    .select("*", { count: "exact" })
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) handleError(error, "getStockMovements");

  const typeNameMap: Record<string, string> = {
    in: "Nhập hàng",
    out: "Xuất hàng",
    adjust: "Kiểm kho",
    transfer: "Chuyển kho",
  };

  const movements: StockMovement[] = (data ?? []).map((row) => ({
    id: row.id,
    code: row.reference_type ? `${row.reference_type.toUpperCase().slice(0, 2)}${row.id.slice(0, 6)}` : row.id.slice(0, 10),
    type: mapMovementType(row.type),
    typeName: typeNameMap[row.type] ?? row.type,
    quantity: row.quantity,
    costPrice: 0,
    totalAmount: 0,
    date: row.created_at,
    note: row.note ?? undefined,
    createdBy: row.created_by,
  }));

  return { data: movements, total: count ?? 0 };
}

// --- Sales History ---

export async function getSalesHistory(
  productId: string,
  params: QueryParams
): Promise<QueryResult<SalesHistory>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  const { data, count, error } = await supabase
    .from("invoice_items")
    .select(`
      id, quantity, unit_price, discount, total,
      invoices!inner(id, code, created_at, customer_name, status, created_by)
    `, { count: "exact" })
    .eq("product_id", productId)
    .order("id", { ascending: false })
    .range(from, to);

  if (error) handleError(error, "getSalesHistory");

  const statusNameMap: Record<string, string> = {
    completed: "Hoàn thành",
    cancelled: "Đã hủy",
    draft: "Phiếu tạm",
    confirmed: "Đã xác nhận",
  };

  const history: SalesHistory[] = (data ?? []).map((row) => {
    const inv = row.invoices as {
      id: string;
      code: string;
      created_at: string;
      customer_name: string;
      status: string;
      created_by: string;
    };
    return {
      id: row.id,
      invoiceCode: inv.code,
      date: inv.created_at,
      customerName: inv.customer_name,
      quantity: row.quantity,
      sellPrice: row.unit_price,
      discount: row.discount,
      totalAmount: row.total,
      status: inv.status as SalesHistory["status"],
      statusName: statusNameMap[inv.status] ?? inv.status,
      createdBy: inv.created_by,
    };
  });

  return { data: history, total: count ?? 0 };
}

// --- Mappers ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProduct(row: any): Product {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    image: row.image_url ?? undefined,
    sellPrice: row.sell_price,
    costPrice: row.cost_price,
    stock: row.stock,
    ordered: 0, // Calculated field - would need aggregation
    categoryId: row.category_id ?? "",
    categoryName: row.categories?.name ?? "Chưa phân loại",
    categoryCode: row.categories?.code ?? undefined,
    unit: row.unit,
    productType: row.product_type ?? "nvl",
    hasBom: row.has_bom ?? false,
    // Map cột boolean `is_active` sang trường `status` (active|inactive) cho FE.
    // FE filter "Trạng thái" + badge "Đang bán/Ngừng bán" đọc từ trường này.
    status: row.is_active === false ? "inactive" : "active",
    purchaseUnit: row.purchase_unit ?? undefined,
    stockUnit: row.stock_unit ?? undefined,
    sellUnit: row.sell_unit ?? undefined,
    shelfLifeDays: row.shelf_life_days ?? undefined,
    shelfLifeUnit: row.shelf_life_unit ?? undefined,
    oldCode: row.old_code ?? undefined,
    groupCode: row.group_code ?? undefined,
    supplierId: row.supplier_id ?? undefined,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProductDetail(row: any, priceBooks: { name: string; price: number }[]): ProductDetail {
  return {
    ...mapProduct(row),
    barcode: row.barcode ?? undefined,
    weight: row.weight ?? undefined,
    description: row.description ?? undefined,
    minStock: row.min_stock,
    maxStock: row.max_stock,
    position: undefined, // Not in DB schema
    allowSale: row.allow_sale,
    properties: [],
    priceBooks,
    images: row.image_url ? [row.image_url] : [],
  };
}

function mapMovementType(dbType: string): StockMovement["type"] {
  const map: Record<string, StockMovement["type"]> = {
    in: "import",
    out: "export",
    adjust: "adjustment",
    transfer: "transfer",
  };
  return map[dbType] ?? "import";
}

// --- Write Operations ---

/**
 * Tạo sản phẩm mới.
 */
export async function createProduct(product: Partial<Product & ProductDetail>): Promise<Product> {
  const supabase = getClient();
  const { getCurrentTenantId } = await import("./base");
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("products")
    .insert({
      tenant_id: tenantId,
      code: product.code!,
      name: product.name!,
      sell_price: product.sellPrice ?? 0,
      cost_price: product.costPrice ?? 0,
      category_id: product.categoryId || null,
      unit: product.unit ?? "Cái",
      stock: product.stock ?? 0,
      min_stock: product.minStock ?? 0,
      max_stock: product.maxStock ?? 1000,
      barcode: product.barcode,
      weight: product.weight,
      description: product.description,
      image_url: product.image,
      allow_sale: product.allowSale ?? true,
      is_active: true,
      product_type: product.productType ?? "nvl",
      has_bom: product.hasBom ?? false,
      group_code: product.groupCode,
      purchase_unit: product.purchaseUnit,
      stock_unit: product.stockUnit,
      sell_unit: product.sellUnit,
      shelf_life_days: product.shelfLifeDays,
    } satisfies ProductInsert)
    .select("*, categories!products_category_id_fkey(name)")
    .single();

  if (error) handleError(error, "createProduct");
  return mapProduct(data);
}

/**
 * Cập nhật sản phẩm.
 */
export async function updateProduct(id: string, updates: Partial<Product & ProductDetail>): Promise<Product> {
  const supabase = getClient();

  const payload: ProductUpdate = {};
  if (updates.code !== undefined) payload.code = updates.code;
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.sellPrice !== undefined) payload.sell_price = updates.sellPrice;
  if (updates.costPrice !== undefined) payload.cost_price = updates.costPrice;
  if (updates.categoryId !== undefined) payload.category_id = updates.categoryId || null;
  if (updates.unit !== undefined) payload.unit = updates.unit;
  if (updates.stock !== undefined) payload.stock = updates.stock;
  if (updates.minStock !== undefined) payload.min_stock = updates.minStock;
  if (updates.maxStock !== undefined) payload.max_stock = updates.maxStock;
  if (updates.barcode !== undefined) payload.barcode = updates.barcode;
  if (updates.weight !== undefined) payload.weight = updates.weight;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.image !== undefined) payload.image_url = updates.image;
  if (updates.allowSale !== undefined) payload.allow_sale = updates.allowSale;
  if (updates.status !== undefined) payload.is_active = updates.status === "active";

  const { data, error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", id)
    .select("*, categories!products_category_id_fkey(name)")
    .single();

  if (error) handleError(error, "updateProduct");
  return mapProduct(data);
}

/**
 * Xóa sản phẩm.
 */
export async function deleteProduct(id: string): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id);

  if (error) handleError(error, "deleteProduct");
}

// --- Bulk Mutations ---

/**
 * Đổi nhóm hàng hàng loạt cho danh sách sản phẩm.
 * Trả về số dòng đã cập nhật thực tế (nếu RLS chặn → có thể nhỏ hơn `ids.length`).
 */
export async function bulkUpdateCategory(
  ids: string[],
  categoryId: string
): Promise<{ count: number }> {
  if (ids.length === 0) return { count: 0 };
  const supabase = getClient();

  const { data, error } = await supabase
    .from("products")
    .update({ category_id: categoryId || null })
    .in("id", ids)
    .select("id");

  if (error) handleError(error, "bulkUpdateCategory");
  return { count: data?.length ?? 0 };
}

/**
 * Đổi giá hàng loạt — chỉ cập nhật field nào được truyền vào.
 * Truyền `sellPrice` thì update giá bán, truyền `costPrice` thì update giá vốn.
 */
export async function bulkUpdatePrice(
  ids: string[],
  updates: { sellPrice?: number; costPrice?: number }
): Promise<{ count: number }> {
  if (ids.length === 0) return { count: 0 };
  if (updates.sellPrice === undefined && updates.costPrice === undefined) {
    return { count: 0 };
  }
  const supabase = getClient();

  const payload: ProductUpdate = {};
  if (updates.sellPrice !== undefined) payload.sell_price = updates.sellPrice;
  if (updates.costPrice !== undefined) payload.cost_price = updates.costPrice;

  const { data, error } = await supabase
    .from("products")
    .update(payload)
    .in("id", ids)
    .select("id");

  if (error) handleError(error, "bulkUpdatePrice");
  return { count: data?.length ?? 0 };
}

/**
 * Xoá sản phẩm hàng loạt.
 * Lưu ý: nếu sản phẩm đang được tham chiếu bởi đơn hàng / kho / BOM,
 * Supabase sẽ trả về lỗi FK constraint — caller cần catch để hiển thị toast.
 */
export async function bulkDeleteProducts(
  ids: string[]
): Promise<{ count: number }> {
  if (ids.length === 0) return { count: 0 };
  const supabase = getClient();

  const { data, error } = await supabase
    .from("products")
    .delete()
    .in("id", ids)
    .select("id");

  if (error) handleError(error, "bulkDeleteProducts");
  return { count: data?.length ?? 0 };
}
