/**
 * Supabase service: Products & Categories
 */

import type { Product, ProductDetail, StockMovement, SalesHistory, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { getClient, getPaginationRange, handleError, getCurrentTenantId } from "./base";
import { isRpcUnavailable } from "./rpc-utils";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

// --- Products ---

export async function getProducts(params: QueryParams): Promise<QueryResult<Product>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  // Filter tenant_id — RLS dev disable nên cần tự filter để tránh leak
  // products của tenant khác. CEO test "Đắk" thấy 4 row NVL-CPH-002 từ
  // 4 tenant khác nhau (1 row hiện nhóm "Bao bì" lạ vì cross-tenant).
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("products")
    .select(
      "*, categories!products_category_id_fkey(name, code), suppliers!products_supplier_id_fkey(name)",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId);

  // Search — dùng `or` với escape `%` để search ký tự đặc biệt OK.
  // Postgres `ilike` là case-insensitive nhưng diacritic-sensitive: search
  // "phe" KHÔNG match "phê" (cần dấu). Tương lai có thể chuyển sang
  // unaccent extension nếu CEO muốn search không dấu.
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(`name.ilike.%${esc}%,code.ilike.%${esc}%`);
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

  // Filter: brand (thương hiệu) — case-sensitive match. "Tất cả" = không
  // filter. Nếu FE truyền "__no_brand__" thì filter brand IS NULL (sản phẩm
  // chưa gán thương hiệu).
  if (params.filters?.brand && params.filters.brand !== "all") {
    const brandFilter = params.filters.brand as string;
    if (brandFilter === "__no_brand__") {
      query = query.is("brand", null);
    } else {
      query = query.eq("brand", brandFilter);
    }
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
  const tenantId = await getCurrentTenantId();
  let query = supabase
    .from("products")
    .select("stock, cost_price", { count: "exact" })
    .eq("tenant_id", tenantId)
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
export async function getProductCategoriesAsync(
  scope?: "nvl" | "sku",
  /**
   * Channel filter (CEO 04/05/2026):
   *   - "retail" → chỉ trả categories có SP retail (cho POS Retail)
   *   - "fnb"    → chỉ trả categories có SP FnB (cho POS FnB)
   *   - undefined → trả tất cả (admin nhóm hàng / list)
   *
   * Auto-compute từ products.channel — không cần column channel ở categories.
   */
  channel?: "retail" | "fnb",
) {
  const supabase = getClient();

  // Filter tenant_id — RLS dev disable nên không tự auto-scope. Trước
  // đây CEO báo "Bao bì × 4" thực ra là 4 tenant khác nhau leak qua.
  const tenantId = await getCurrentTenantId();

  let catQuery = supabase
    .from("categories")
    .select("id, name, code, scope")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });

  if (scope) catQuery = catQuery.eq("scope", scope);

  const { data: categories, error } = await catQuery;
  if (error) handleError(error, "getProductCategoriesAsync");

  // Count per category: chỉ select 1 column (category_id), filter is_active
  // để bỏ soft-deleted. Không select product_type (đã filter qua scope).
  let prodQuery = supabase
    .from("products")
    .select("category_id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (scope) prodQuery = prodQuery.eq("product_type", scope);
  // CEO 04/05: filter channel để POS Retail không thấy category FnB và
  // ngược lại. Auto-compute từ products → category trống bị ẩn (chấp nhận).
  if (channel) prodQuery = prodQuery.eq("channel", channel);
  const { data: products } = await prodQuery;

  // Map count theo category_id — sau migration 00039 không còn duplicate id
  // theo cùng (tenant, code, scope) nên đếm trực tiếp.
  const countByCategoryId = new Map<string, number>();
  for (const p of products ?? []) {
    const cid = p.category_id as string | null;
    if (!cid) continue;
    countByCategoryId.set(cid, (countByCategoryId.get(cid) ?? 0) + 1);
  }

  return (categories ?? [])
    // Khi có channel: chỉ giữ category có ít nhất 1 SP. Không có channel
    // → giữ all (admin xem full list).
    .filter((cat) => !channel || countByCategoryId.has(cat.id))
    .map((cat) => ({
      label: cat.name,
      value: cat.id,
      code: cat.code ?? undefined,
      count: countByCategoryId.get(cat.id) ?? 0,
    }));
}

/**
 * Danh sách thương hiệu (brand) distinct có trong tenant.
 *
 * Dùng cho filter sidebar ở trang Hàng hoá. Chỉ trả brand của sản phẩm
 * is_active=true để khỏi kẹt brand "ma" từ sản phẩm đã xoá mềm. Có thể
 * filter theo scope (nvl/sku) để chỉ hiện brand phù hợp với tab đang xem.
 */
export async function getProductBrands(scope?: "nvl" | "sku"): Promise<string[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("products")
    .select("brand")
    .eq("tenant_id", tenantId)
    .not("brand", "is", null)
    .eq("is_active", true);

  if (scope) query = query.eq("product_type", scope);

  const { data, error } = await query;
  if (error) {
    // Filter brand không critical — fail silent để không chặn list page.
    console.warn("[getProductBrands] failed:", error.message);
    return [];
  }

  const unique = new Set<string>();
  for (const row of data ?? []) {
    const b = (row as { brand: string | null }).brand;
    if (b && b.trim()) unique.add(b.trim());
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b, "vi"));
}

export async function getProductById(id: string): Promise<ProductDetail | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Defense-in-depth: id là UUID global unique nhưng vẫn filter tenant để
  // tránh leak nếu URL bị share / scan.
  const { data, error } = await supabase
    .from("products")
    .select(
      "*, categories!products_category_id_fkey(name, code), suppliers!products_supplier_id_fkey(name)",
    )
    .eq("tenant_id", tenantId)
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
    supplierName: row.suppliers?.name ?? undefined,
    // Mở rộng: trước đây list view chỉ map các field cơ bản → detail panel
    // phải hardcode null vì không có dữ liệu. Nay đưa các field DB nhẹ vào
    // list fetch (barcode/weight/description/brand/min-max) để panel render
    // thẳng không cần fetch thêm.
    barcode: row.barcode ?? undefined,
    weight: row.weight ?? undefined,
    description: row.description ?? undefined,
    brand: row.brand ?? undefined,
    minStock: row.min_stock ?? undefined,
    maxStock: row.max_stock ?? undefined,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProductDetail(row: any, priceBooks: { name: string; price: number }[]): ProductDetail {
  return {
    ...mapProduct(row),
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
      shelf_life_unit: product.shelfLifeUnit,
      supplier_id: product.supplierId,
      brand: product.brand,
    } satisfies ProductInsert)
    .select(
      "*, categories!products_category_id_fkey(name, code), suppliers!products_supplier_id_fkey(name)",
    )
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
  // Thương hiệu + thêm các field còn lại — đưa vào payload khi có thay đổi.
  // Dùng `null` thay vì `undefined` để cho phép xoá brand/nhà cung cấp/trọng
  // lượng đã gán trước đó (user clear field trong form edit).
  if (updates.brand !== undefined) payload.brand = updates.brand || null;
  if (updates.supplierId !== undefined) payload.supplier_id = updates.supplierId || null;
  if (updates.weight !== undefined) payload.weight = updates.weight ?? null;
  if (updates.purchaseUnit !== undefined) payload.purchase_unit = updates.purchaseUnit || null;
  if (updates.stockUnit !== undefined) payload.stock_unit = updates.stockUnit || null;
  if (updates.sellUnit !== undefined) payload.sell_unit = updates.sellUnit || null;
  if (updates.shelfLifeDays !== undefined) payload.shelf_life_days = updates.shelfLifeDays ?? null;
  if (updates.shelfLifeUnit !== undefined) payload.shelf_life_unit = updates.shelfLifeUnit || "day";
  if (updates.hasBom !== undefined) payload.has_bom = updates.hasBom;

  const { data, error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", id)
    .select(
      "*, categories!products_category_id_fkey(name, code), suppliers!products_supplier_id_fkey(name)",
    )
    .single();

  if (error) handleError(error, "updateProduct");
  return mapProduct(data);
}

/**
 * Xóa sản phẩm.
 *
 * Sprint S2 Phase 1 (CEO 12/05): chuyển sang RPC SECURITY DEFINER để enforce
 * quyền `products.delete` ở DB layer.
 *
 * Sprint S2 Phase 3a (CEO 12/05): nhận optional `otpId` để hỗ trợ delegation
 * — cashier không có quyền vẫn xoá được nếu có OTP đã verify từ manager.
 * Backend (migration 00062) re-check permission của OTP issuer thay vì actor.
 *
 * @param id Product ID cần xoá
 * @param otpId Optional — UUID của row manager_otp_codes đã verify_and_use.
 *   Server check OTP used_at < 60s + action_code = 'crm.delete_party'
 *   + used_by = current user → cho phép bỏ qua permission check của actor,
 *   dùng permission của OTP issuer.
 */
export async function deleteProduct(id: string, otpId?: string): Promise<void> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "delete_product_atomic",
    {
      p_product_id: id,
      p_otp_id: otpId ?? null,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC delete_product_atomic. Vui lòng chạy migration 00060_secure_delete_rpcs trước khi xoá sản phẩm.",
      );
    }
    handleError(error, "deleteProduct:atomic_rpc");
  }

  if (!data || (typeof data === "object" && "success" in data && !data.success)) {
    throw new Error("Server không trả kết quả xoá sản phẩm hợp lệ.");
  }
}

/**
 * Sprint D — CEO 06/05: Đổi vị trí sort_order của 1 SP với neighbor.
 *
 * Pattern: tương tự moveCategorySortOrder nhưng scope theo (category_id,
 * product_type, channel) — vì FnB POS hiển thị SP theo category, sort phải
 * stable trong cùng category. SP không có category_id → swap toàn tenant.
 *
 * Trước đây sort_order được set 1 lần khi tạo SP, không có UI đổi → CEO báo
 * "sắp xếp thực đơn theo ý". Giờ admin bấm ↑↓ để move SP lên xuống trong
 * danh mục, ảnh hưởng thứ tự hiển thị POS FnB grid + POS Retail.
 *
 * @returns true nếu đã swap, false nếu không có neighbor (đầu/cuối list).
 */
export async function moveProductSortOrder(
  productId: string,
  direction: "up" | "down",
): Promise<boolean> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Lấy current product info — cần category_id + product_type + channel để
  // scope query đúng (tránh swap cross-category gây hỗn loạn).
  // Note: Database types chưa generate `sort_order` cho products (column tồn
  // tại runtime nhưng schema migration chưa bump types). Cast `any` để
  // bypass — KHI nào regen types qua `supabase gen types` thì xoá cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: currentRaw, error: e1 } = await (supabase as any)
    .from("products")
    .select("id, sort_order, category_id, product_type, channel")
    .eq("tenant_id", tenantId)
    .eq("id", productId)
    .single();
  if (e1 || !currentRaw) throw e1 ?? new Error("Không tìm thấy sản phẩm");
  const current = currentRaw as {
    id: string;
    sort_order: number;
    category_id: string | null;
    product_type: string | null;
    channel: string | null;
  };

  // Build neighbor query — scope theo category nếu có, fallback toàn tenant.
  // RLS đã filter tenant, nhưng vẫn .eq() cho rõ + tận dụng index composite.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let neighborQuery = (supabase as any)
    .from("products")
    .select("id, sort_order")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (current.category_id) {
    neighborQuery = neighborQuery.eq("category_id", current.category_id);
  } else {
    neighborQuery = neighborQuery.is("category_id", null);
  }
  if (current.product_type) {
    neighborQuery = neighborQuery.eq("product_type", current.product_type);
  }
  if (current.channel) {
    neighborQuery = neighborQuery.eq("channel", current.channel);
  }

  if (direction === "up") {
    neighborQuery = neighborQuery
      .lt("sort_order", current.sort_order)
      .order("sort_order", { ascending: false });
  } else {
    neighborQuery = neighborQuery
      .gt("sort_order", current.sort_order)
      .order("sort_order", { ascending: true });
  }

  const { data: neighbors } = await neighborQuery.limit(1);
  if (!neighbors || neighbors.length === 0) return false;

  const neighbor = neighbors[0] as { id: string; sort_order: number };

  // Swap atomic — 2 update tuần tự, nếu update thứ 2 fail thì có thể bị
  // duplicate sort_order tạm thời nhưng không corrupt data (UNIQUE constraint
  // không có trên sort_order). Production sẽ migration dùng RPC swap atomic
  // nếu cần (đã có pattern cho categories).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: e2 } = await (supabase as any)
    .from("products")
    .update({ sort_order: neighbor.sort_order })
    .eq("id", productId);
  if (e2) throw e2;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: e3 } = await (supabase as any)
    .from("products")
    .update({ sort_order: current.sort_order })
    .eq("id", neighbor.id);
  if (e3) throw e3;

  return true;
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

// ============================================================
// Sao chép sản phẩm — clone existing product với code mới
// Sprint UX-1 fix mockup (CEO 04/05/2026): trước đây "Nhân bản" chỉ
// toast "Đang phát triển". Giờ tạo bản copy thật với code tự động
// generate (gắn suffix "-COPY" hoặc next code).
// ============================================================

/**
 * Sao chép sản phẩm: load source → insert copy mới với:
 * - Code mới: prepend "COPY-" + timestamp ngắn (đảm bảo unique)
 * - Tên: thêm "(Bản sao)" vào cuối
 * - RESET stock=0, has_bom=false (bản copy bắt đầu sạch tồn)
 * - GIỮ category, supplier, prices, unit, vat_rate, channel...
 *
 * Trả về Product mới — caller có thể setEditing(newProduct) mở form sửa
 * cho user tinh chỉnh trước khi finalize.
 */
export async function duplicateProduct(sourceId: string): Promise<Product> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // 1. Load source full detail
  const source = await getProductById(sourceId);
  if (!source) throw new Error("Không tìm thấy sản phẩm để sao chép");

  // 2. Generate new code — suffix timestamp 6 chữ số tránh trùng
  const ts = Date.now().toString().slice(-6);
  const newCode = `${source.code}-${ts}`;
  const newName = `${source.name} (Bản sao)`;

  // 3. Insert copy
  const { data, error } = await supabase
    .from("products")
    .insert({
      tenant_id: tenantId,
      code: newCode,
      name: newName,
      sell_price: source.sellPrice,
      cost_price: source.costPrice,
      category_id: source.categoryId || null,
      unit: source.unit,
      stock: 0, // bắt đầu tồn 0 — admin nhập kho riêng
      min_stock: source.minStock ?? 0,
      max_stock: source.maxStock ?? 1000,
      vat_rate: source.vatRate ?? 0,
      barcode: null, // không clone barcode (unique per SP)
      weight: source.weight,
      description: source.description,
      image_url: source.image,
      allow_sale: source.allowSale ?? true,
      is_active: true,
      product_type: source.productType,
      channel: source.productType === "sku" ? (source.channel ?? null) : null,
      has_bom: false, // bản copy bắt đầu không có BOM
      group_code: source.groupCode,
      purchase_unit: source.purchaseUnit,
      stock_unit: source.stockUnit,
      sell_unit: source.sellUnit,
      shelf_life_days: source.shelfLifeDays,
      shelf_life_unit: source.shelfLifeUnit,
      supplier_id: source.supplierId,
      brand: source.brand,
    } satisfies ProductInsert)
    .select(
      "*, categories!products_category_id_fkey(name, code), suppliers!products_supplier_id_fkey(name)",
    )
    .single();

  if (error) handleError(error, "duplicateProduct");
  return mapProduct(data);
}
