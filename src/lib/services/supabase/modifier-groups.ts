/**
 * Modifier Groups & Options service (CEO 01/06/2026 — Phase 2.2).
 *
 * Quản lý các nhóm tuỳ chọn món FnB:
 *   - modifier_groups: Mức đường, Mức đá, Topping, Size...
 *   - modifier_options: 0%/30%/50%/70%/100%, Trân châu, Thạch...
 *
 * Schema từ migration 00121. RLS đảm bảo tenant scoping tự động.
 */

import { getClient, handleError, getCurrentTenantId } from "./base";

export type ModifierRule = "single_required" | "single" | "multi";
export type ModifierChannel = "fnb" | "retail" | "all";

export interface ModifierGroup {
  id: string;
  tenantId: string;
  name: string;
  rule: ModifierRule;
  channel: ModifierChannel;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Số option trong group (loaded riêng). */
  optionCount?: number;
}

export interface ModifierOption {
  id: string;
  groupId: string;
  label: string;
  /** Phí cộng cho topping. Đường/đá thường = 0. */
  priceDelta: number;
  /** Tỷ lệ scale BOM ingredient (cho Mức đường: 0/0.3/0.5/0.7/1.0). */
  scaleFactor: number | null;
  /** Link tới NVL/SKU cho topping. */
  linkedProductId: string | null;
  linkedProductCode?: string;
  linkedProductName?: string;
  isDefault: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface ModifierGroupInput {
  name: string;
  rule: ModifierRule;
  channel?: ModifierChannel;
  sortOrder?: number;
}

export interface ModifierOptionInput {
  label: string;
  priceDelta?: number;
  scaleFactor?: number | null;
  linkedProductId?: string | null;
  isDefault?: boolean;
  sortOrder?: number;
}

// ────────────────────────────────────────────────────────────
// GROUPS
// ────────────────────────────────────────────────────────────

export async function listModifierGroups(): Promise<ModifierGroup[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { data, error } = await supabase
    .from("modifier_groups")
    .select("*, modifier_options(count)")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) handleError(error, "listModifierGroups");
  return ((data ?? []) as RawGroup[]).map((row) => mapGroup(row));
}

export async function createModifierGroup(input: ModifierGroupInput): Promise<ModifierGroup> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("modifier_groups")
    .insert({
      tenant_id: tenantId,
      name: input.name.trim(),
      rule: input.rule,
      channel: input.channel ?? "fnb",
      sort_order: input.sortOrder ?? 0,
    })
    .select("*")
    .single();
  if (error) handleError(error, "createModifierGroup");
  return mapGroup(data);
}

export async function updateModifierGroup(
  id: string,
  input: Partial<ModifierGroupInput>,
): Promise<ModifierGroup> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.rule !== undefined) patch.rule = input.rule;
  if (input.channel !== undefined) patch.channel = input.channel;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  const { data, error } = await supabase
    .from("modifier_groups")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) handleError(error, "updateModifierGroup");
  return mapGroup(data);
}

export async function deleteModifierGroup(id: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  // Soft delete: is_active=false để giữ audit. Cascade options qua FK.
  const { error } = await supabase
    .from("modifier_groups")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) handleError(error, "deleteModifierGroup");
}

// ────────────────────────────────────────────────────────────
// OPTIONS
// ────────────────────────────────────────────────────────────

export async function listModifierOptions(groupId: string): Promise<ModifierOption[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { data, error } = await supabase
    .from("modifier_options")
    .select("*, products!modifier_options_linked_product_id_fkey(code, name)")
    .eq("group_id", groupId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) handleError(error, "listModifierOptions");
  return ((data ?? []) as RawOption[]).map((row) => mapOption(row));
}

export async function createModifierOption(
  groupId: string,
  input: ModifierOptionInput,
): Promise<ModifierOption> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { data, error } = await supabase
    .from("modifier_options")
    .insert({
      group_id: groupId,
      label: input.label.trim(),
      price_delta: input.priceDelta ?? 0,
      scale_factor: input.scaleFactor ?? null,
      linked_product_id: input.linkedProductId ?? null,
      is_default: input.isDefault ?? false,
      sort_order: input.sortOrder ?? 0,
    })
    .select("*, products!modifier_options_linked_product_id_fkey(code, name)")
    .single();
  if (error) handleError(error, "createModifierOption");
  return mapOption(data);
}

export async function updateModifierOption(
  id: string,
  input: Partial<ModifierOptionInput>,
): Promise<ModifierOption> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.priceDelta !== undefined) patch.price_delta = input.priceDelta;
  if (input.scaleFactor !== undefined) patch.scale_factor = input.scaleFactor;
  if (input.linkedProductId !== undefined) patch.linked_product_id = input.linkedProductId;
  if (input.isDefault !== undefined) patch.is_default = input.isDefault;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  const { data, error } = await supabase
    .from("modifier_options")
    .update(patch)
    .eq("id", id)
    .select("*, products!modifier_options_linked_product_id_fkey(code, name)")
    .single();
  if (error) handleError(error, "updateModifierOption");
  return mapOption(data);
}

export async function deleteModifierOption(id: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { error } = await supabase
    .from("modifier_options")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) handleError(error, "deleteModifierOption");
}

// ────────────────────────────────────────────────────────────
// Mappers
// ────────────────────────────────────────────────────────────

interface RawGroup {
  id: string;
  tenant_id: string;
  name: string;
  rule: ModifierRule;
  channel: ModifierChannel;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  modifier_options?: { count: number }[];
}

interface RawOption {
  id: string;
  group_id: string;
  label: string;
  price_delta: number;
  scale_factor: number | null;
  linked_product_id: string | null;
  is_default: boolean;
  sort_order: number;
  is_active: boolean;
  products?: { code: string; name: string } | null;
}

function mapGroup(row: RawGroup): ModifierGroup {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    rule: row.rule,
    channel: row.channel,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    optionCount: row.modifier_options?.[0]?.count ?? 0,
  };
}

function mapOption(row: RawOption): ModifierOption {
  return {
    id: row.id,
    groupId: row.group_id,
    label: row.label,
    priceDelta: Number(row.price_delta),
    scaleFactor: row.scale_factor !== null ? Number(row.scale_factor) : null,
    linkedProductId: row.linked_product_id,
    linkedProductCode: row.products?.code,
    linkedProductName: row.products?.name,
    isDefault: row.is_default,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}
