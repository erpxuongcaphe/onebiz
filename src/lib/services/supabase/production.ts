// Production service — Production orders, lot tracking, FIFO allocation

import { getClient, handleError } from "./base";
import { getCurrentTenantId } from "./base";
import type {
  ProductionOrder,
  ProductLot,
  ExpiringLot,
} from "@/lib/types";
import { formatDateInputValue } from "@/lib/format";
import { normalizeCreatedAtRange } from "@/lib/utils/list-date-preset-range";

const supabase = getClient();

// ============================================================
// Production Orders
// ============================================================

export async function getProductionOrders(params?: {
  status?: string;
  branchId?: string;
  limit?: number;
  offset?: number;
}) {
  let query = supabase
    .from("production_orders")
    .select(
      "*, products!production_orders_product_id_fkey(name, code), branches!production_orders_branch_id_fkey(name), profiles!production_orders_created_by_fkey(full_name)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  if (params?.status) query = query.eq("status", params.status);
  if (params?.branchId) query = query.eq("branch_id", params.branchId);
  if (params?.limit) query = query.limit(params.limit);
  if (params?.offset) query = query.range(params.offset, params.offset + (params.limit ?? 20) - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    data: (data ?? []).map(mapProductionOrder),
    total: count ?? 0,
  };
}

export interface ProductionOrderListWorkspaceParams {
  page:number; pageSize:number; search?:string; searchField?:string; statuses?:string[];
  dateFrom?:string; dateTo?:string; createdBy?:string; qtyMin?:number; qtyMax?:number; branchId?:string;
}
export interface ProductionOrderListWorkspaceResult {
  data:ProductionOrder[]; total:number;
  summary:{inProgressCount:number;completedTodayCount:number;cancelledCount:number;totalCogs:number};
}
export async function getProductionOrderListWorkspace(params:ProductionOrderListWorkspaceParams):Promise<ProductionOrderListWorkspaceResult>{
  const client=getClient(); const {from,toExclusive}=normalizeCreatedAtRange({dateFrom:params.dateFrom,dateTo:params.dateTo});
  const {data,error}=await(client.rpc as any)("get_production_order_list_workspace",{
    p_page:params.page,p_page_size:params.pageSize,p_search:params.search?.trim()||null,p_search_field:params.searchField??"all",
    p_statuses:params.statuses?.length?params.statuses:null,p_date_from:from??null,p_date_to_exclusive:toExclusive??null,
    p_created_by:params.createdBy||null,p_qty_min:Number.isFinite(params.qtyMin)?params.qtyMin:null,
    p_qty_max:Number.isFinite(params.qtyMax)?params.qtyMax:null,p_branch_id:params.branchId??null,
  });
  if(error)handleError(error,"getProductionOrderListWorkspace");
  const payload=(data??{})as Record<string,any>; const summary=(payload.summary??{})as Record<string,unknown>;
  return{data:Array.isArray(payload.items)?payload.items.map(mapProductionOrder):[],total:Number(payload.total??0),summary:{
    inProgressCount:Number(summary.inProgressCount??0),completedTodayCount:Number(summary.completedTodayCount??0),
    cancelledCount:Number(summary.cancelledCount??0),totalCogs:Number(summary.totalCogs??0),
  }};
}
export async function getProductionOrdersForExport(params:Omit<ProductionOrderListWorkspaceParams,"page"|"pageSize">):Promise<ProductionOrder[]>{
  const rows:ProductionOrder[]=[];for(let page=0;;page+=1){const result=await getProductionOrderListWorkspace({...params,page,pageSize:200});rows.push(...result.data);if(rows.length>=result.total||result.data.length===0)return rows;}
}

export async function getProductionOrderById(id: string) {
  const { data, error } = await supabase
    .from("production_orders")
    .select(
      "*, products!production_orders_product_id_fkey(name, code), branches!production_orders_branch_id_fkey(name), profiles!production_orders_created_by_fkey(full_name)"
    )
    .eq("id", id)
    .single();
  if (error) throw error;

  const { data: materials } = await supabase
    .from("production_order_materials")
    .select("*, products!production_order_materials_product_id_fkey(name, code)")
    .eq("production_order_id", id);

  const order = mapProductionOrder(data as Record<string, unknown>);
  order.materials = (materials ?? []).map((m) => {
    const row = m as Record<string, unknown>;
    const prod = row.products as Record<string, unknown> | undefined;
    return {
      id: row.id as string,
      productionOrderId: row.production_order_id as string,
      productId: row.product_id as string,
      productName: (prod?.name as string) ?? "",
      productCode: (prod?.code as string) ?? "",
      plannedQty: row.planned_qty as number,
      actualQty: (row.actual_qty as number) ?? 0,
      unit: row.unit as string,
      unitCost: (row.unit_cost as number) ?? undefined,
    };
  });
  return order;
}

export async function createProductionOrder(order: {
  branchId: string;
  bomId: string;
  productId: string;
  variantId?: string;
  plannedQty: number;
  plannedStart?: string;
  plannedEnd?: string;
  notes?: string;
  materials: {
    productId: string;
    plannedQty: number;
    unit: string;
  }[];
}) {
  const { data, error } = await (supabase.rpc as any)(
    "create_production_order_atomic",
    {
      p_input: {
        branch_id: order.branchId,
        bom_id: order.bomId,
        product_id: order.productId,
        variant_id: order.variantId ?? null,
        planned_qty: order.plannedQty,
        planned_start: order.plannedStart ?? null,
        planned_end: order.plannedEnd ?? null,
        notes: order.notes ?? null,
        materials: order.materials.map((material) => ({
          product_id: material.productId,
          planned_qty: material.plannedQty,
          unit: material.unit,
        })),
      },
    },
  );
  if (error) throw error;
  return data as {
    id: string;
    code: string;
    status: string;
    branch_id: string;
  };
}

// Valid transitions for production status (state machine)
const VALID_PRODUCTION_TRANSITIONS: Record<string, string[]> = {
  planned: ["material_check", "cancelled"],
  material_check: ["in_production", "planned", "cancelled"],
  in_production: ["quality_check", "cancelled"],
  quality_check: ["completed", "in_production", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionProductionStatus(from: string, to: string): boolean {
  return VALID_PRODUCTION_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function updateProductionStatus(
  orderId: string,
  newStatus: string
) {
  if (newStatus === "completed" || newStatus === "cancelled") {
    throw new Error(
      newStatus === "completed"
        ? "Hãy dùng nút Hoàn thành để hệ thống trừ nguyên liệu và nhập thành phẩm."
        : "Hãy dùng nút Hủy để hệ thống hoàn nguyên tồn kho đúng cách.",
    );
  }

  const { error } = await (supabase.rpc as any)(
    "change_production_status_atomic",
    {
      p_production_order_id: orderId,
      p_new_status: newStatus,
    },
  );
  if (error) throw error;
}

/**
 * Hủy lệnh sản xuất với rollback NVL (Sprint SX-1).
 *
 * Trước đây cancel chỉ flip status → nếu đã consume (status >= material_check)
 * thì NVL đã trừ kho mất luôn. Giờ gọi RPC `revert_production_materials`
 * để atomic đảo stock_movements + restore branch_stock + reset
 * actual_qty + flip status.
 *
 * Status hợp lệ: planned/material_check/in_production/quality_check.
 * Completed KHÔNG cho cancel (lot đã tạo, cần luồng riêng xuất hủy).
 *
 * Không có fallback đổi trạng thái đơn lẻ. Nếu RPC chưa sẵn sàng, thao tác
 * phải dừng để tránh trạng thái lệnh và tồn kho lệch nhau.
 */
export async function cancelProductionOrder(
  orderId: string,
  reason?: string,
): Promise<{ revertedMaterialsQty: number; revertedCogs: number }> {
  const { data, error } = await (supabase.rpc as any)(
    "revert_production_materials",
    {
      p_production_order_id: orderId,
      p_reason: reason ?? null,
    },
  );
  if (error) throw error;

  const result = (data ?? {}) as Record<string, unknown>;
  return {
    revertedMaterialsQty: Number(result.reverted_materials_qty ?? 0),
    revertedCogs: Number(result.reverted_cogs ?? 0),
  };
}

export async function completeProductionOrder(
  productionOrderId: string,
  completedQty: number,
  lotNumber?: string,
  manufacturedDate?: string,
  expiryDate?: string
) {
  const { data, error } = await supabase.rpc("complete_production_order", {
    p_production_order_id: productionOrderId,
    p_completed_qty: completedQty,
    p_lot_number: lotNumber,
    p_manufactured_date: manufacturedDate,
    p_expiry_date: expiryDate,
  });

  if (error) throw error;
  return data as string; // lot_id
}

export async function consumeProductionMaterials(productionOrderId: string) {
  const { error } = await supabase.rpc("consume_production_materials", {
    p_production_order_id: productionOrderId,
  });

  if (error) throw error;
}

/**
 * CEO 06/07/2026 — Hoàn thành lệnh SX NGUYÊN TỬ: gộp trừ NVL + nhập thành phẩm
 * trong 1 giao dịch (RPC 00159). Lỗi giữa chừng tự rollback CẢ HAI → không bao
 * giờ còn cảnh "trừ NVL mà không ra thành phẩm" + bấm lại trừ kép. Thay cho việc
 * gọi consumeProductionMaterials rồi completeProductionOrder rời nhau.
 */
export async function completeProductionAtomic(
  productionOrderId: string,
  completedQty: number,
  lotNumber?: string,
  manufacturedDate?: string,
  expiryDate?: string
) {
  // RPC 00159 chưa có trong types sinh tự động (giống create_internal_sale_atomic).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("complete_production_atomic", {
    p_production_order_id: productionOrderId,
    p_completed_qty: completedQty,
    p_lot_number: lotNumber,
    p_manufactured_date: manufacturedDate,
    p_expiry_date: expiryDate,
  });

  if (error) {
    const code = (error as { code?: string }).code;
    const message = (error as { message?: string }).message ?? "";
    const rpcMissing = code === "PGRST202" || /complete_production_atomic/i.test(message);
    if (rpcMissing) {
      throw new Error(
        "RPC complete_production_atomic chưa sẵn sàng. Vui lòng chạy migration 00159 và reload schema trước khi hoàn thành sản xuất để tránh lệch kho.",
      );
    }
    throw error;
  }
  return data as string; // lot_id
}

// ============================================================
// Material Availability Check
// ============================================================

export interface MaterialCheckInput {
  productId: string;
  productName?: string;
  plannedQty: number;
  unit?: string;
}

export interface MaterialCheckResult {
  productId: string;
  productName: string;
  needed: number;
  available: number;
  unit: string;
  sufficient: boolean;
  shortage: number;
}

/**
 * Kiểm tra NVL có đủ tồn kho trước khi hoàn thành/bắt đầu lệnh SX.
 * Query branch_stock theo branchId + productId, so với plannedQty.
 *
 * Dùng chung cho: CompleteProductionOrderDialog, future pre-start material
 * check, batch production planning.
 */
export async function checkMaterialsAvailability(
  branchId: string,
  materials: MaterialCheckInput[],
): Promise<MaterialCheckResult[]> {
  if (!materials.length) return [];

  const productIds = materials.map((m) => m.productId);
  const { data, error } = await supabase
    .from("branch_stock")
    .select("product_id, quantity")
    .eq("branch_id", branchId)
    .in("product_id", productIds);

  if (error) throw error;

  const stockMap = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ product_id: string; quantity: number | string }>) {
    stockMap.set(row.product_id, Number(row.quantity ?? 0));
  }

  return materials.map((mat) => {
    const available = stockMap.get(mat.productId) ?? 0;
    const needed = Number(mat.plannedQty ?? 0);
    const shortage = Math.max(0, needed - available);
    return {
      productId: mat.productId,
      productName: mat.productName ?? mat.productId,
      needed,
      available,
      unit: mat.unit ?? "",
      sufficient: available >= needed,
      shortage,
    };
  });
}

// ============================================================
// Lot Tracking
// ============================================================

/** Query ALL product lots across all products — for the lots listing page */
export async function getAllProductLots(options?: {
  search?: string;
  status?: string;
  sourceType?: string;
  branchId?: string;
  fetchAll?: boolean;
}): Promise<(ProductLot & { productName: string; productCode: string })[]> {
  const tenantId = await getCurrentTenantId();

  const pageSize = options?.fetchAll ? 1000 : 200;
  const rows: Record<string, unknown>[] = [];

  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from("product_lots")
      .select("*, products!inner(name, code)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (options?.branchId) {
      query = query.eq("branch_id", options.branchId);
    }
    if (options?.status && options.status !== "all") {
      query = query.eq("status", options.status);
    }
    if (options?.sourceType && options.sourceType !== "all") {
      query = query.eq("source_type", options.sourceType);
    }
    if (options?.search) {
      query = query.or(
        `lot_number.ilike.%${options.search}%,products.name.ilike.%${options.search}%`,
      );
    }

    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (!options?.fetchAll || page.length < pageSize) break;
  }

  return rows.map((row) => {
    const product = row.products as Record<string, unknown> | null;
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      productId: row.product_id as string,
      productName: (product?.name as string) ?? "",
      productCode: (product?.code as string) ?? "",
      lotNumber: row.lot_number as string,
      sourceType: row.source_type as "production" | "purchase",
      productionOrderId: row.production_order_id as string | undefined,
      purchaseOrderId: row.purchase_order_id as string | undefined,
      manufacturedDate: row.manufactured_date as string | undefined,
      expiryDate: row.expiry_date as string | undefined,
      receivedDate: row.received_date as string,
      initialQty: row.initial_qty as number,
      currentQty: row.current_qty as number,
      branchId: row.branch_id as string,
      branchName: "",
      status: (row.status as ProductLot["status"]) ?? "active",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  });
}

export async function getProductLots(
  productId: string,
  branchId?: string
): Promise<ProductLot[]> {
  const { data, error } = await supabase.rpc("get_lots_for_product", {
    p_product_id: productId,
    p_branch_id: branchId ?? undefined,
  });

  if (error) throw error;
  const items = (data as unknown[]) ?? [];
  return items.map((item) => {
    const row = item as Record<string, unknown>;
    return {
    id: row.id as string,
    tenantId: "",
    productId,
    lotNumber: row.lot_number as string,
    sourceType: row.source_type as "production" | "purchase",
    manufacturedDate: (row.manufactured_date as string) ?? undefined,
    expiryDate: (row.expiry_date as string) ?? undefined,
    receivedDate: row.received_date as string,
    initialQty: row.initial_qty as number,
    currentQty: row.current_qty as number,
    branchId: "",
    branchName: row.branch_name as string,
    status: "active" as const,
    expiryStatus: row.expiry_status as ProductLot["expiryStatus"],
    daysUntilExpiry: row.days_until_expiry as number | undefined,
    createdAt: "",
    updatedAt: "",
  };
  });
}

export async function allocateLotsFIFO(params: {
  productId: string;
  branchId: string;
  quantity: number;
  sourceType: "invoice" | "production" | "transfer" | "disposal";
  sourceId: string;
}) {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase.rpc("allocate_lots_fifo", {
    p_tenant_id: tenantId,
    p_product_id: params.productId,
    p_branch_id: params.branchId,
    p_quantity: params.quantity,
    p_source_type: params.sourceType,
    p_source_id: params.sourceId,
  });

  if (error) throw error;
  return data as {
    allocated: { lot_id: string; lot_number: string; quantity: number }[];
    total_allocated: number;
    shortage: number;
  };
}

export async function getExpiringLots(
  daysThreshold?: number
): Promise<{ thresholdDays: number; total: number; lots: ExpiringLot[] }> {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase.rpc("check_expiring_lots", {
    p_tenant_id: tenantId,
    p_days_threshold: daysThreshold ?? 30,
  });

  if (error) throw error;
  const raw = data as Record<string, unknown>;
  return {
    thresholdDays: raw.threshold_days as number,
    total: raw.total as number,
    lots: ((raw.lots as unknown[]) ?? []).map((item) => {
      const l = item as Record<string, unknown>;
      return {
        lotId: l.lot_id as string,
        lotNumber: l.lot_number as string,
        productId: l.product_id as string,
        productName: l.product_name as string,
        productCode: l.product_code as string,
        expiryDate: l.expiry_date as string,
        currentQty: l.current_qty as number,
        branchName: l.branch_name as string,
        daysRemaining: l.days_remaining as number,
        isExpired: l.is_expired as boolean,
      };
    }),
  };
}

// ============================================================
// Create lot manually (for purchase receipts)
// ============================================================

export async function createPurchaseLot(lot: {
  productId: string;
  variantId?: string;
  lotNumber: string;
  purchaseOrderId?: string;
  supplierId?: string;
  manufacturedDate?: string;
  expiryDate?: string;
  quantity: number;
  branchId: string;
}) {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("product_lots")
    .insert({
      tenant_id: tenantId,
      product_id: lot.productId,
      variant_id: lot.variantId,
      lot_number: lot.lotNumber,
      source_type: "purchase",
      purchase_order_id: lot.purchaseOrderId,
      supplier_id: lot.supplierId,
      manufactured_date: lot.manufacturedDate,
      expiry_date: lot.expiryDate,
      // E (07/07): dùng helper an toàn múi giờ — trước 7h sáng VN, toISOString()
      // lùi 1 ngày (UTC) → sai ngày nhập lô (ảnh hưởng HSD/FIFO).
      received_date: formatDateInputValue(new Date()),
      initial_qty: lot.quantity,
      current_qty: lot.quantity,
      branch_id: lot.branchId,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================================================
// Mappers
// ============================================================

function mapProductionOrder(row: Record<string, unknown>): ProductionOrder {
  const product = row.products as Record<string, unknown> | undefined;
  const branch = row.branches as Record<string, unknown> | undefined;
  const profile = row.profiles as { full_name: string } | null;
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    code: row.code as string,
    branchId: row.branch_id as string,
    branchName: (branch?.name as string) ?? undefined,
    bomId: row.bom_id as string,
    productId: row.product_id as string,
    productName: (product?.name as string) ?? undefined,
    productCode: (product?.code as string) ?? undefined,
    variantId: (row.variant_id as string) ?? undefined,
    plannedQty: row.planned_qty as number,
    completedQty: (row.completed_qty as number) ?? 0,
    status: row.status as ProductionOrder["status"],
    lotNumber: (row.lot_number as string) ?? undefined,
    plannedStart: (row.planned_start as string) ?? undefined,
    plannedEnd: (row.planned_end as string) ?? undefined,
    actualStart: (row.actual_start as string) ?? undefined,
    actualEnd: (row.actual_end as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
    cogsAmount: (row.cogs_amount as number) ?? undefined,
    createdBy: (row.created_by as string) ?? undefined,
    createdByName: profile?.full_name ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
