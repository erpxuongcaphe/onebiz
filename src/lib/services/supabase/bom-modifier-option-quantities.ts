/**
 * Exact FnB recipe quantities.
 *
 * The browser only reads the small mapping list. Saving is one atomic RPC so
 * a network interruption cannot leave a BOM half-configured.
 */

import { getClient, getCurrentTenantId, handleError } from "./base";
import type { BOMModifierOptionQuantity } from "@/lib/types";

export interface SaveBOMModifierOptionQuantityInput {
  materialId: string;
  modifierOptionId: string;
  quantity: number;
}

export async function listBOMModifierOptionQuantities(
  bomId: string,
): Promise<BOMModifierOptionQuantity[]> {
  const tenantId = await getCurrentTenantId();
  // Generated Supabase types are intentionally refreshed only after the SQL
  // migration is installed. Keep this isolated cast instead of weakening all
  // other typed product/BOM queries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { data, error } = await supabase
    .from("bom_modifier_option_quantities")
    .select("id, tenant_id, bom_id, material_id, modifier_option_id, quantity, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("bom_id", bomId);
  if (error) handleError(error, "listBOMModifierOptionQuantities");
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    bomId: String(row.bom_id),
    materialId: String(row.material_id),
    modifierOptionId: String(row.modifier_option_id),
    quantity: Number(row.quantity),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export async function saveBOMModifierOptionQuantities(
  bomId: string,
  rows: SaveBOMModifierOptionQuantityInput[],
): Promise<void> {
  const unique = new Set<string>();
  for (const row of rows) {
    if (!row.materialId || !row.modifierOptionId || !Number.isFinite(row.quantity) || row.quantity < 0) {
      throw new Error("Mỗi định lượng phải có nguyên liệu, lựa chọn và số lượng từ 0 trở lên.");
    }
    const key = `${row.materialId}:${row.modifierOptionId}`;
    if (unique.has(key)) {
      throw new Error("Có định lượng bị lặp trong cùng công thức.");
    }
    unique.add(key);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (getClient() as any).rpc(
    "save_bom_modifier_option_quantities",
    {
      p_bom_id: bomId,
      p_rows: rows.map((row) => ({
        materialId: row.materialId,
        modifierOptionId: row.modifierOptionId,
        quantity: row.quantity,
      })),
    },
  );
  if (error) handleError(error, "saveBOMModifierOptionQuantities");
}
