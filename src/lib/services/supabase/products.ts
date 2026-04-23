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

  // Filter: channel (fnb | retail) — phân tách sản phẩm theo kênh bán
  // Dùng ở POS FnB (channel='fnb') và POS Retail (channel='retail').
  if (params.filters?.channel && params.filters.channel !== "all") {
    query = query.eq("channel", params.filters.channel as string);
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
 * Aggregate stats cho list page Hàng hoá — hiển thị 4 SummaryCard đầu trang.
 *
 * Trả về:
 *   - totalCount  : tổng số SP theo scope
 *   - stockValue  : tổng giá trị tồn kho (sum stock × cost_price)
 *   - outOfStock  : số SP hết hàng (stock = 0)
 *   - lowStock    : số SP sắp hết (0 < stock ≤ 5)
 *
 * Dùng 1 query lightweight (`select stock, cost_price`) và reduce client-side.
 * Với 5000 SP payload ~50KB — acceptable cho go-live. Nếu scale lớn hơn thì
 * chuyển sang Postgres RPC function (xem comment trong body).
 */
export async function getProductStats(scope: "nvl" | "sku" | "all" = "all"): Promise<{
  totalCount: number;
  stockValue: number;
  outOfStock: number;
  lowStock: number;
}> {
  const supabase = getClient();
  let query = supabase
    .from("products")
    .select("stock, cost_price", { count: "exact" })
    .eq("is_active", true);

  if (scope !== "all") {
    query = query.eq("product_type", scope);
  }

  const { data, count, error } = await query;
  if (error) handleError(error, "getProductStats");

  let stockValue = 0;
  let outOfStock = 0;
  let lowStock = 0;

  for (const row of data ?? []) {
    const stock = Number((row as { stock: number | null }).stock ?? 0);
    const cost = Number((row as { cost_price: number | null }).cost_price ?? 0);
    stockValue += stock * cost;
    if (stock === 0) outOfStock++;
    else if (stock <= 5) lowStock++;
  }

  return {
    totalCount: count ?? 0,
    stockValue,
    outOfStock,
    lowStock,
  };
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
 *
 * Perf note: trước đây `prodQuery` pull TOÀN BỘ products của tenant (có thể
 * 2000-5000 rows — cả NVL + SKU retail + FnB) chỉ để đếm products/category.
 * Payload 500KB-1.5MB mỗi lần POS mở → 800-1500ms blocking cold start.
 *
 * Fix: dùng Postgres `count` aggregate qua `group by category_id` gọi qua
 * PostgREST `count: "exact"` trên từng category — thực ra PostgREST không hỗ
 * trợ group-by count elegant, nên chiến lược tối ưu: chỉ fetch `category_id`
 * (1 column, nhỏ) + filter `is_active=true` để bỏ products đã xoá.
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

  // Count per category: chỉ select 1 column (category_id), filter is_active
  // để bỏ soft-deleted. Không select product_type (đã filter qua scope).
  let prodQuery = supabase
    .from("products")
    .select("category_id")
    .eq("is_active", true);
  if (scope) prodQuery = prodQuery.eq("product_type", scope);
  const { data: products } = await prodQuery;

  // Dedupe categories by normalized name. Trước đây CEO báo "Cà phê chai × 4"
  // ở POS Retail header do seed data duplicate — dedupe ở FE giữ id đầu tiên +
  // cộng dồn count cho cùng name.
  const byName = new Map<
    string,
    { id: string; name: string; code: string | null }
  >();
  for (const cat of categories ?? []) {
    const key = String(cat.name ?? "").trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, cat);
  }

  return Array.from(byName.values()).map((cat) => {
    // Count products ở TẤT CẢ id có cùng name (đề phòng dupe id nhưng sản phẩm
    // đã gắn rải rác nhiều id).
    const sameIds = (categories ?? [])
      .filter(
        (c) =>
          String(c.name ?? "").trim().toLowerCase() ===
          String(cat.name ?? "").trim().toLowerCase(),
      )
      .map((c) => c.id);
    return {
      label: cat.name,
      value: cat.id,
      code: cat.code ?? undefined,
      count: (products ?? []).filter((p) =>
        sameIds.includes(p.category_id as string),
      ).length,
    };
  });
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

// --- Stock Movement (enriched) type for all-movements page ---

export interface AllStockMovementRow extends StockMovement {
  productName: string;
  productCode: string;
  referenceType?: string;
  referenceId?: string;
  branchId?: string;
}

// --- All Stock Movements (cross-product) ---

export async function getAllStockMovements(
  params: QueryParams & { movementType?: string; branchId?: string }
): Promise<QueryResult<AllStockMovementRow>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("stock_movements")
    .select("*, products!inner(name, code), profiles!stock_movements_created_by_fkey(full_name)", { count: "exact" });

  // Search by product name/code or note
  if (params.search) {
    query = query.or(
      `note.ilike.%${params.search}%,products.name.ilike.%${params.search}%,products.code.ilike.%${params.search}%`
    );
  }

  // Filter by movement type
  if (params.movementType && params.movementType !== "all") {
    query = query.eq("type", params.movementType as "in" | "out" | "adjust" | "transfer");
  }

  // Filter by branch
  if (params.branchId && params.branchId !== "all") {
    query = query.eq("branch_id", params.branchId);
  }

  // Sort
  query = query.order("created_at", { ascending: false });

  // Paginate
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getAllStockMovements");

  const typeNameMap: Record<string, string> = {
    in: "Nhập hàng",
    out: "Xuất hàng",
    adjust: "Kiểm kho",
    transfer: "Chuyển kho",
  };

  const movements: AllStockMovementRow[] = (data ?? []).map((row: any) => ({
    id: row.id,
    code: row.reference_type
      ? `${row.reference_type.toUpperCase().slice(0, 2)}${row.id.slice(0, 6)}`
      : row.id.slice(0, 10),
    type: mapMovementType(row.type),
    typeName: typeNameMap[row.type] ?? row.type,
    quantity: row.quantity,
    costPrice: 0,
    totalAmount: 0,
    date: row.created_at,
    note: row.note ?? undefined,
    createdBy: row.created_by,
    createdByName: (row.profiles as { full_name: string } | null)?.full_name ?? "",
    productName: row.products?.name ?? "—",
    productCode: row.products?.code ?? "—",
    referenceType: row.reference_type ?? undefined,
    referenceId: row.reference_id ?? undefined,
    branchId: row.branch_id ?? undefined,
  }));

  return { data: movements, total: count ?? 0 };
}

// --- Stock Movements (per product) ---

export async function getStockMovements(
  productId: string,
  params: QueryParams
): Promise<QueryResult<StockMovement>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  const { data, count, error } = await supabase
    .from("stock_movements")
    .select("*, profiles!stock_movements_created_by_fkey(full_name)", { count: "exact" })
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const movements: StockMovement[] = (data ?? []).map((row: any) => ({
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
    createdByName: (row.profiles as { full_name: string } | null)?.full_name ?? "",
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
      invoices!inner(id, code, created_at, customer_name, status, created_by, profiles!invoices_created_by_fkey(full_name))
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
    const inv = row.invoices as unknown as {
      id: string;
      code: string;
      created_at: string;
      customer_name: string;
      status: string;
      created_by: string;
      profiles?: { full_name: string } | null;
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
      createdBy: inv.profiles?.full_name ?? "—",
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
    channel: row.channel ?? undefined,
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
    vatRate: row.vat_rate ?? 0,
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
      vat_rate: product.vatRate ?? 0,
      barcode: product.barcode,
      weight: product.weight,
      description: product.description,
      image_url: product.image,
      allow_sale: product.allowSale ?? true,
      is_active: true,
      product_type: product.productType ?? "nvl",
      // Kênh bán: chỉ gán cho SKU (fnb/retail). NVL giữ NULL.
      channel: product.productType === "sku" ? (product.channel ?? null) : null,
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
  if (updates.vatRate !== undefined) payload.vat_rate = updates.vatRate;
  if (updates.barcode !== undefined) payload.barcode = updates.barcode;
  if (updates.weight !== undefined) payload.weight = updates.weight;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.image !== undefined) payload.image_url = updates.image;
  if (updates.allowSale !== undefined) payload.allow_sale = updates.allowSale;
  if (updates.status !== undefined) payload.is_active = updates.status === "active";
  // Kênh bán fnb|retail (hoặc null khi quay về NVL)
  if (updates.channel !== undefined) {
    payload.channel = updates.channel ?? null;
  }

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
