/**
 * Supabase service: Products & Categories
 */

import type { Product, ProductDetail, StockMovement, SalesHistory, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError } from "./base";

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
export async function getProductCategoriesAsync() {
  const supabase = getClient();

  const { data: categories, error } = await supabase
    .from("categories")
    .select("id, name")
    .order("sort_order", { ascending: true });

  if (error) handleError(error, "getProductCategoriesAsync");

  // Get counts per category
  const { data: products } = await supabase
    .from("products")
    .select("category_id");

  return (categories ?? []).map((cat) => ({
    label: cat.name,
    value: cat.id,
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
    unit: row.unit,
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
