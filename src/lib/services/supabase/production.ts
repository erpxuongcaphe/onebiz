// Production service — Production orders, lot tracking, FIFO allocation

import { getClient } from "./base";
import { getCurrentTenantId } from "./base";
import type {
  ProductionOrder,
  ProductLot,
  ExpiringLot,
} from "@/lib/types";

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
  const tenantId = await getCurrentTenantId();
  // Generate code
  const { data: codeData } = await supabase.rpc("next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "production_order",
  });

  const { data, error } = await supabase
    .from("production_orders")
    .insert({
      tenant_id: tenantId,
      code: codeData as string,
      branch_id: order.branchId,
      bom_id: order.bomId,
      product_id: order.productId,
      variant_id: order.variantId ?? undefined,
      planned_qty: order.plannedQty,
      planned_start: order.plannedStart ?? undefined,
      planned_end: order.plannedEnd ?? undefined,
      notes: order.notes ?? undefined,
    })
    .select()
    .single();

  if (error) throw error;

  // Insert materials — kèm unit_cost từ products.cost_price để tính COGS chính xác.
  // Nếu không fetch được cost_price (lỗi mạng / sản phẩm không tồn tại) → vẫn
  // insert với unit_cost = 0 để không chặn luồng tạo lệnh sản xuất.
  if (order.materials.length > 0) {
    const materialProductIds = order.materials.map((m) => m.productId);
    const costMap = new Map<string, number>();
    try {
      const { data: products } = await supabase
        .from("products")
        .select("id, cost_price")
        .in("id", materialProductIds);
      (products ?? []).forEach((p) => {
        const row = p as { id: string; cost_price: number | null };
        costMap.set(row.id, Number(row.cost_price ?? 0));
      });
    } catch {
      // Ignore — fallback về unit_cost = 0
    }

    const { error: matError } = await supabase
      .from("production_order_materials")
      .insert(
        order.materials.map((m) => ({
          production_order_id: data.id,
          product_id: m.productId,
          planned_qty: m.plannedQty,
          unit: m.unit,
          unit_cost: costMap.get(m.productId) ?? 0,
        }))
      );

    if (matError) throw matError;
  }

  return data;
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
  const { data: current, error: getErr } = await supabase
    .from("production_orders")
    .select("status")
    .eq("id", orderId)
    .single();
  if (getErr) throw getErr;

  const from = current?.status as string;
  if (!canTransitionProductionStatus(from, newStatus)) {
    throw new Error(
      `Không thể chuyển trạng thái từ "${from}" sang "${newStatus}"`
    );
  }

  const { error } = await supabase
    .from("production_orders")
    .update({ status: newStatus })
    .eq("id", orderId);

  if (error) throw error;
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
}): Promise<(ProductLot & { productName: string; productCode: string })[]> {
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("product_lots")
    .select("*, products!inner(name, code)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (options?.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }
  if (options?.sourceType && options.sourceType !== "all") {
    query = query.eq("source_type", options.sourceType);
  }
  if (options?.search) {
    query = query.or(
      `lot_number.ilike.%${options.search}%,products.name.ilike.%${options.search}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => {
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
      received_date: new Date().toISOString().split("T")[0],
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
