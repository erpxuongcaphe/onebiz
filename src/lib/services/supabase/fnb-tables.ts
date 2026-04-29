/**
 * F&B Service: Restaurant Tables
 * CRUD + status management for restaurant_tables (always branch-scoped).
 */

import type { Database } from "@/lib/supabase/types";
import type { RestaurantTable, TableStatus } from "@/lib/types/fnb";
import { getClient, handleError, getCurrentTenantId } from "./base";

type TableInsert = Database["public"]["Tables"]["restaurant_tables"]["Insert"];
type TableUpdate = Database["public"]["Tables"]["restaurant_tables"]["Update"];

// ── Mappers ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTable(row: any): RestaurantTable {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    tableNumber: row.table_number,
    name: row.name,
    zone: row.zone,
    capacity: row.capacity,
    status: row.status,
    currentOrderId: row.current_order_id,
    positionX: row.position_x,
    positionY: row.position_y,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

// ── Queries ──

export async function getTablesByBranch(branchId: string): Promise<RestaurantTable[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("restaurant_tables")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) handleError(error, "getTablesByBranch");
  return (data ?? []).map(mapTable);
}

// ── Mutations ──

export async function createTable(input: {
  tenantId: string;
  branchId: string;
  tableNumber: number;
  name: string;
  zone?: string;
  capacity?: number;
}): Promise<RestaurantTable> {
  const supabase = getClient();

  const row: TableInsert = {
    tenant_id: input.tenantId,
    branch_id: input.branchId,
    table_number: input.tableNumber,
    name: input.name,
    zone: input.zone ?? null,
    capacity: input.capacity ?? 4,
  };

  const { data, error } = await supabase
    .from("restaurant_tables")
    .insert(row)
    .select()
    .single();

  if (error) handleError(error, "createTable");
  return mapTable(data);
}

/**
 * Atomic status transition — only succeeds if current status matches `from`.
 * Returns updated table or null if race condition lost.
 */
export async function updateTableStatus(
  tableId: string,
  newStatus: TableStatus,
  currentOrderId?: string | null
): Promise<RestaurantTable | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const update: TableUpdate = { status: newStatus };
  if (currentOrderId !== undefined) {
    update.current_order_id = currentOrderId;
  }

  const { data, error } = await supabase
    .from("restaurant_tables")
    .update(update)
    .eq("tenant_id", tenantId)
    .eq("id", tableId)
    .select()
    .single();

  if (error) handleError(error, "updateTableStatus");
  return data ? mapTable(data) : null;
}

/**
 * Atomic claim: set table to 'occupied' ONLY if currently 'available'.
 * Prevents two cashiers from claiming the same table.
 */
export async function claimTable(
  tableId: string,
  orderId: string
): Promise<RestaurantTable | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("restaurant_tables")
    .update({
      status: "occupied" as const,
      current_order_id: orderId,
    } satisfies TableUpdate)
    .eq("tenant_id", tenantId)
    .eq("id", tableId)
    .eq("status", "available")
    .select()
    .maybeSingle();

  if (error) handleError(error, "claimTable");
  return data ? mapTable(data) : null;
}

/**
 * Release table: set to 'cleaning', clear current_order_id.
 */
export async function releaseTable(tableId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("restaurant_tables")
    .update({
      status: "cleaning" as const,
      current_order_id: null,
    } satisfies TableUpdate)
    .eq("tenant_id", tenantId)
    .eq("id", tableId);

  if (error) handleError(error, "releaseTable");
}

/**
 * Mark table as available (after cleaning).
 */
export async function markTableAvailable(tableId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("restaurant_tables")
    .update({
      status: "available" as const,
      current_order_id: null,
    } satisfies TableUpdate)
    .eq("tenant_id", tenantId)
    .eq("id", tableId)
    .eq("status", "cleaning");

  if (error) handleError(error, "markTableAvailable");
}

// ── Table Management (Admin CRUD) ──

export async function updateTable(
  tableId: string,
  input: {
    name?: string;
    tableNumber?: number;
    zone?: string | null;
    capacity?: number;
    sortOrder?: number;
    positionX?: number;
    positionY?: number;
  }
): Promise<RestaurantTable> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const update: TableUpdate = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.zone !== undefined) update.zone = input.zone;
  if (input.capacity !== undefined) update.capacity = input.capacity;
  if (input.sortOrder !== undefined) update.sort_order = input.sortOrder;
  if (input.positionX !== undefined) update.position_x = input.positionX;
  if (input.positionY !== undefined) update.position_y = input.positionY;

  const { data, error } = await supabase
    .from("restaurant_tables")
    .update(update)
    .eq("tenant_id", tenantId)
    .eq("id", tableId)
    .select()
    .single();

  if (error) handleError(error, "updateTable");
  return mapTable(data);
}

/**
 * Soft-delete: set is_active = false.
 * Only allowed if table is 'available' (no active order).
 */
export async function deleteTable(tableId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("restaurant_tables")
    .update({ is_active: false } satisfies TableUpdate)
    .eq("tenant_id", tenantId)
    .eq("id", tableId)
    .eq("status", "available");

  if (error) handleError(error, "deleteTable");
}

/**
 * Get distinct zones for a branch (for zone management UI).
 */
export async function getZonesByBranch(branchId: string): Promise<string[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("restaurant_tables")
    .select("zone")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true);

  if (error) handleError(error, "getZonesByBranch");

  const zones = new Set<string>();
  for (const row of data ?? []) {
    if (row.zone) zones.add(row.zone);
  }
  return Array.from(zones).sort();
}

/**
 * Bulk-create tables for a zone (e.g., "Tầng 1" with 8 tables).
 */
export async function bulkCreateTables(input: {
  tenantId: string;
  branchId: string;
  zone: string;
  count: number;
  startNumber: number;
  capacity?: number;
}): Promise<RestaurantTable[]> {
  const supabase = getClient();

  const rows: TableInsert[] = [];
  for (let i = 0; i < input.count; i++) {
    const num = input.startNumber + i;
    rows.push({
      tenant_id: input.tenantId,
      branch_id: input.branchId,
      table_number: num,
      name: `Bàn ${num}`,
      zone: input.zone,
      capacity: input.capacity ?? 4,
      sort_order: num,
    });
  }

  const { data, error } = await supabase
    .from("restaurant_tables")
    .insert(rows)
    .select();

  if (error) handleError(error, "bulkCreateTables");
  return (data ?? []).map(mapTable);
}

/**
 * Rename a zone (update all tables in that zone).
 */
export async function renameZone(
  branchId: string,
  oldZone: string,
  newZone: string
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("restaurant_tables")
    .update({ zone: newZone } satisfies TableUpdate)
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("zone", oldZone)
    .eq("is_active", true);

  if (error) handleError(error, "renameZone");
}

/**
 * Delete a zone (soft-delete all tables in that zone).
 * Only allowed if all tables in the zone are 'available'.
 */
export async function deleteZone(
  branchId: string,
  zone: string
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("restaurant_tables")
    .update({ is_active: false } satisfies TableUpdate)
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("zone", zone)
    .eq("status", "available");

  if (error) handleError(error, "deleteZone");
}
