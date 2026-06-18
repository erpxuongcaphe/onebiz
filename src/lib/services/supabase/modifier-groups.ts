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
  const name = input.name.trim();

  // FIX 16/06/2026 (CEO báo bug): deleteModifierGroup chỉ XOÁ MỀM (is_active=false)
  // nhưng GIỮ lại dòng tên cũ → INSERT lại cùng tên đụng ràng buộc
  // unique (tenant_id, name) → lỗi 23505. Xử lý: nếu đã có nhóm trùng tên:
  //   - is_active=false (đã xoá)  → KÍCH HOẠT LẠI (khôi phục nhóm + option cũ).
  //   - is_active=true  (đang dùng) → trùng thật → báo lỗi tiếng Việt rõ ràng.
  const { data: existing } = await supabase
    .from("modifier_groups")
    .select("id, is_active")
    .eq("tenant_id", tenantId)
    .eq("name", name)
    .maybeSingle();
  if (existing) {
    if (existing.is_active) {
      throw new Error(
        `Nhóm tuỳ chọn "${name}" đã tồn tại. Hãy đặt tên khác hoặc sửa nhóm cũ.`,
      );
    }
    const { data: reactivated, error: reErr } = await supabase
      .from("modifier_groups")
      .update({
        is_active: true,
        rule: input.rule,
        channel: input.channel ?? "fnb",
        sort_order: input.sortOrder ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (reErr) handleError(reErr, "createModifierGroup:reactivate");
    return mapGroup(reactivated);
  }

  const { data, error } = await supabase
    .from("modifier_groups")
    .insert({
      tenant_id: tenantId,
      name,
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
// PRESET — Seed 4 nhóm tuỳ chọn FnB Việt chuẩn (CEO 01/06/2026)
// ────────────────────────────────────────────────────────────
// Click 1 lần ở /hang-hoa/tuy-chon-fnb → tạo sẵn Size + Mức đường +
// Mức đá + Topping (rỗng). Idempotent: nếu group đã tồn tại theo tên
// (UNIQUE tenant_id+name) → skip để tránh duplicate.
//
// CEO 01/06/2026: KHÔNG POS lớn nào có preset VN — đây là gap OneBiz
// lấp để cafe owner setup nhanh hơn KiotViet/Sapo/iPOS.

export interface PresetSeedResult {
  groupsCreated: number;
  groupsSkipped: number;
  optionsCreated: number;
}

export async function seedFnbVnPreset(): Promise<PresetSeedResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const tenantId = await getCurrentTenantId();

  let groupsCreated = 0;
  let groupsSkipped = 0;
  let optionsCreated = 0;

  // Load existing groups by name + is_active (FIX 16/06/2026):
  // xoá nhóm là XOÁ MỀM (is_active=false) nhưng dòng vẫn còn → bản cũ chỉ
  // check theo tên rồi bỏ qua, khiến nhóm đã xoá KHÔNG được khôi phục mà
  // cũng không tạo lại được (đụng unique tên). Giờ phân biệt active/đã-xoá.
  const { data: existing } = await supabase
    .from("modifier_groups")
    .select("id, name, is_active")
    .eq("tenant_id", tenantId);
  const existingByName = new Map<string, { id: string; isActive: boolean }>(
    ((existing ?? []) as Array<{ id: string; name: string; is_active: boolean }>).map((g) => [
      g.name,
      { id: g.id, isActive: g.is_active },
    ]),
  );

  // Định nghĩa nhóm tuỳ chọn chuẩn. CEO 17/06/2026: BỎ nhóm "Size" khỏi preset —
  // size giờ là QUY CÁCH (product_variants) + công thức theo size, KHÔNG phải
  // modifier. Để cả hai sẽ ra 2 ô chọn size trên POS gây nhầm. Size = variant.
  const presets: Array<{
    name: string;
    rule: ModifierRule;
    sortOrder: number;
    options: Array<{
      label: string;
      priceDelta?: number;
      scaleFactor?: number | null;
      isDefault?: boolean;
      sortOrder: number;
    }>;
  }> = [
    {
      name: "Mức đường",
      rule: "single",
      sortOrder: 2,
      options: [
        { label: "Không đường", scaleFactor: 0, sortOrder: 1 },
        { label: "30%", scaleFactor: 0.3, sortOrder: 2 },
        { label: "50%", scaleFactor: 0.5, sortOrder: 3 },
        { label: "70%", scaleFactor: 0.7, isDefault: true, sortOrder: 4 },
        { label: "100%", scaleFactor: 1.0, sortOrder: 5 },
      ],
    },
    {
      name: "Mức đá",
      rule: "single",
      sortOrder: 3,
      options: [
        { label: "Không đá", sortOrder: 1 },
        { label: "Ít đá", sortOrder: 2 },
        { label: "Vừa đá", isDefault: true, sortOrder: 3 },
        { label: "Nhiều đá", sortOrder: 4 },
      ],
    },
    {
      name: "Topping",
      rule: "multi",
      sortOrder: 4,
      options: [
        // Rỗng — CEO tự thêm vì phải link NVL/SKU topping riêng của quán
      ],
    },
  ];

  for (const preset of presets) {
    const found = existingByName.get(preset.name);

    // Nhóm đang dùng (active) → giữ nguyên, không đụng.
    if (found && found.isActive) {
      groupsSkipped++;
      continue;
    }

    let groupId: string;
    if (found && !found.isActive) {
      // Nhóm đã xoá-mềm → KÍCH HOẠT LẠI đúng dòng cũ (không tạo trùng tên).
      const { error: reErr } = await supabase
        .from("modifier_groups")
        .update({
          is_active: true,
          rule: preset.rule,
          channel: "fnb",
          sort_order: preset.sortOrder,
          updated_at: new Date().toISOString(),
        })
        .eq("id", found.id);
      if (reErr) handleError(reErr, "seedFnbVnPreset.reactivate");
      groupId = found.id;
    } else {
      // Chưa từng có → tạo mới.
      const { data: newGroup, error: groupErr } = await supabase
        .from("modifier_groups")
        .insert({
          tenant_id: tenantId,
          name: preset.name,
          rule: preset.rule,
          channel: "fnb",
          sort_order: preset.sortOrder,
        })
        .select("id")
        .single();
      if (groupErr) handleError(groupErr, "seedFnbVnPreset.createGroup");
      groupId = (newGroup as { id: string }).id;
    }
    groupsCreated++;

    // Thêm options chuẩn — CHỈ khi nhóm hiện không còn option active nào.
    // (Nhóm khôi phục thường đã giữ lại options cũ → không nhân đôi.)
    if (preset.options.length > 0) {
      const { data: liveOpts } = await supabase
        .from("modifier_options")
        .select("id")
        .eq("group_id", groupId)
        .eq("is_active", true)
        .limit(1);
      if (((liveOpts ?? []) as unknown[]).length === 0) {
        const optionRows = preset.options.map((o) => ({
          group_id: groupId,
          label: o.label,
          price_delta: o.priceDelta ?? 0,
          scale_factor: o.scaleFactor ?? null,
          is_default: o.isDefault ?? false,
          sort_order: o.sortOrder,
        }));
        const { error: optErr } = await supabase
          .from("modifier_options")
          .insert(optionRows);
        if (optErr) handleError(optErr, "seedFnbVnPreset.createOptions");
        optionsCreated += preset.options.length;
      }
    }
  }

  return { groupsCreated, groupsSkipped, optionsCreated };
}

// ────────────────────────────────────────────────────────────
// CATEGORY MODIFIER LINKS — gán modifier groups cho cả nhóm SP
// ────────────────────────────────────────────────────────────
// Pattern Toast: gán 1 lần cho category "Cà phê" → mọi SP trong nhóm
// tự thừa kế. SP nào không override sẽ dùng list này.

export interface CategoryModifierLink {
  id: string;
  categoryId: string;
  modifierGroupId: string;
  sortOrder: number;
}

export async function listCategoryModifierLinks(
  categoryId: string,
): Promise<CategoryModifierLink[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { data, error } = await supabase
    .from("category_modifier_groups")
    .select("id, category_id, modifier_group_id, sort_order")
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: true });
  if (error) handleError(error, "listCategoryModifierLinks");
  return ((data ?? []) as Array<{
    id: string;
    category_id: string;
    modifier_group_id: string;
    sort_order: number;
  }>).map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    modifierGroupId: r.modifier_group_id,
    sortOrder: r.sort_order,
  }));
}

/**
 * Set toàn bộ modifier groups cho category — replace pattern.
 * Truyền array groupIds → service tự diff (insert mới, xoá cũ).
 * Idempotent: gọi nhiều lần với cùng input → kết quả như nhau.
 */
export async function setCategoryModifierGroups(
  categoryId: string,
  groupIds: string[],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const tenantId = await getCurrentTenantId();

  const existing = await listCategoryModifierLinks(categoryId);
  const existingIds = new Set(existing.map((l) => l.modifierGroupId));
  const newIds = new Set(groupIds);

  // Xoá những link không còn trong list mới
  const toDelete = existing.filter((l) => !newIds.has(l.modifierGroupId));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("category_modifier_groups")
      .delete()
      .in(
        "id",
        toDelete.map((l) => l.id),
      );
    if (error) handleError(error, "setCategoryModifierGroups.delete");
  }

  // Thêm mới
  const toInsert = groupIds
    .filter((id) => !existingIds.has(id))
    .map((id, idx) => ({
      tenant_id: tenantId,
      category_id: categoryId,
      modifier_group_id: id,
      sort_order: existing.length + idx,
    }));
  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("category_modifier_groups")
      .insert(toInsert);
    if (error) handleError(error, "setCategoryModifierGroups.insert");
  }
}

// ────────────────────────────────────────────────────────────
// PRODUCT MODIFIER LINKS — override cho 1 SP cụ thể
// ────────────────────────────────────────────────────────────
// Khi SP cần khác nhóm (vd Bạc xỉu thêm Topping kem cheese mà nhóm
// CFS không có), gán riêng ở đây. SP sẽ dùng list này thay vì inherit.

export interface ProductModifierLink {
  id: string;
  productId: string;
  modifierGroupId: string;
  ruleOverride: ModifierRule | null;
  sortOrder: number;
}

export async function listProductModifierLinks(
  productId: string,
): Promise<ProductModifierLink[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { data, error } = await supabase
    .from("product_modifier_groups")
    .select("id, product_id, modifier_group_id, rule_override, sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
  if (error) handleError(error, "listProductModifierLinks");
  return ((data ?? []) as Array<{
    id: string;
    product_id: string;
    modifier_group_id: string;
    rule_override: ModifierRule | null;
    sort_order: number;
  }>).map((r) => ({
    id: r.id,
    productId: r.product_id,
    modifierGroupId: r.modifier_group_id,
    ruleOverride: r.rule_override,
    sortOrder: r.sort_order,
  }));
}

export async function setProductModifierGroups(
  productId: string,
  groupIds: string[],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const tenantId = await getCurrentTenantId();

  const existing = await listProductModifierLinks(productId);
  const existingIds = new Set(existing.map((l) => l.modifierGroupId));
  const newIds = new Set(groupIds);

  const toDelete = existing.filter((l) => !newIds.has(l.modifierGroupId));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("product_modifier_groups")
      .delete()
      .in(
        "id",
        toDelete.map((l) => l.id),
      );
    if (error) handleError(error, "setProductModifierGroups.delete");
  }

  const toInsert = groupIds
    .filter((id) => !existingIds.has(id))
    .map((id, idx) => ({
      tenant_id: tenantId,
      product_id: productId,
      modifier_group_id: id,
      sort_order: existing.length + idx,
    }));
  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("product_modifier_groups")
      .insert(toInsert);
    if (error) handleError(error, "setProductModifierGroups.insert");
  }
}

/**
 * Resolve modifier groups effective cho 1 SP — pattern inheritance Toast.
 *
 * Quy tắc:
 *   1. Nếu SP có product_modifier_groups → DÙNG (override).
 *   2. Nếu không → INHERIT từ category_modifier_groups của nhóm SP đó.
 *
 * Đây là hàm POS FnB sẽ gọi khi cashier tap món để biết phải hiện
 * tuỳ chọn nào.
 */
export async function getEffectiveModifierGroupsForProduct(
  productId: string,
  categoryId: string | null,
): Promise<ModifierGroup[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;

  // 1. Check SP-level override
  const productLinks = await listProductModifierLinks(productId);
  const groupIds = productLinks.length > 0
    ? productLinks.map((l) => l.modifierGroupId)
    : categoryId
      ? (await listCategoryModifierLinks(categoryId)).map((l) => l.modifierGroupId)
      : [];

  if (groupIds.length === 0) return [];

  const { data, error } = await supabase
    .from("modifier_groups")
    .select("*, modifier_options(count)")
    .in("id", groupIds)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) handleError(error, "getEffectiveModifierGroupsForProduct");
  return ((data ?? []) as RawGroup[]).map((row) => mapGroup(row));
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
