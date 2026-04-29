/**
 * Split Bill Service — Split a kitchen order into multiple bills.
 *
 * splitByItems: moves selected items to a new child kitchen order
 * splitEqually: creates child orders by distributing items N ways
 */

import { getClient, handleError, getCurrentTenantId } from "./base";

export interface SplitResult {
  /** The newly created child order ID */
  childOrderId: string;
  /** Remaining parent order items count */
  parentItemsLeft: number;
}

/**
 * Split specific items from a kitchen order into a new child order.
 * Moves the selected items to the child; parent keeps the rest.
 */
export async function splitByItems(
  orderId: string,
  itemIds: string[]
): Promise<SplitResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  if (itemIds.length === 0) throw new Error("Chọn ít nhất 1 món để tách");

  // 1. Get parent order (filter tenant defense)
  const { data: parent, error: parentErr } = await supabase
    .from("kitchen_orders")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .single();
  if (parentErr || !parent) throw new Error("Không tìm thấy đơn bếp");

  // 2. Get items to split — scope qua kitchen_order_id (đã verify ownership ở step 1)
  const { data: allItems } = await supabase
    .from("kitchen_order_items")
    .select("*")
    .eq("kitchen_order_id", orderId);

  const remaining = (allItems ?? []).filter((i) => !itemIds.includes(i.id));
  if (remaining.length === 0) throw new Error("Không thể tách hết món — cần giữ lại ít nhất 1 món");

  // 3. Create child order
  const { data: child, error: childErr } = await supabase
    .from("kitchen_orders")
    .insert({
      tenant_id: parent.tenant_id,
      branch_id: parent.branch_id,
      table_id: parent.table_id,
      order_number: parent.order_number + "-B",
      order_type: parent.order_type,
      status: parent.status,
      note: `Tách từ ${parent.order_number}`,
      created_by: parent.created_by,
      parent_order_id: orderId,
    })
    .select()
    .single();
  if (childErr || !child) handleError(childErr ?? { message: "Split failed" }, "splitByItems");

  // 4. Move items to child order
  const { error: moveErr } = await supabase
    .from("kitchen_order_items")
    .update({ kitchen_order_id: child.id })
    .in("id", itemIds);
  if (moveErr) handleError(moveErr, "splitByItems.moveItems");

  return {
    childOrderId: child.id,
    parentItemsLeft: remaining.length,
  };
}

/**
 * Split a kitchen order equally into N parts.
 * Creates N-1 child orders. Items are distributed round-robin.
 */
export async function splitEqually(
  orderId: string,
  numberOfWays: number
): Promise<{ childOrderIds: string[] }> {
  if (numberOfWays < 2) throw new Error("Cần ít nhất 2 phần");

  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // 1. Get parent (filter tenant defense)
  const { data: parent, error: parentErr } = await supabase
    .from("kitchen_orders")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .single();
  if (parentErr || !parent) throw new Error("Không tìm thấy đơn bếp");

  // 2. Get all items — scope qua kitchen_order_id (đã verify ownership ở step 1)
  const { data: allItems } = await supabase
    .from("kitchen_order_items")
    .select("*")
    .eq("kitchen_order_id", orderId)
    .order("created_at" as string);

  const items = allItems ?? [];
  if (items.length < numberOfWays) {
    throw new Error(`Chỉ có ${items.length} món, không đủ chia ${numberOfWays} phần`);
  }

  // 3. Distribute items: first batch stays with parent, rest go to children
  const batches: string[][] = Array.from({ length: numberOfWays }, () => []);
  items.forEach((item, idx) => {
    batches[idx % numberOfWays].push(item.id);
  });

  // 4. Create children and move items
  const childOrderIds: string[] = [];
  for (let i = 1; i < numberOfWays; i++) {
    const suffix = String.fromCharCode(65 + i); // B, C, D...
    const { data: child, error: childErr } = await supabase
      .from("kitchen_orders")
      .insert({
        tenant_id: parent.tenant_id,
        branch_id: parent.branch_id,
        table_id: parent.table_id,
        order_number: `${parent.order_number}-${suffix}`,
        order_type: parent.order_type,
        status: parent.status,
        note: `Chia đều từ ${parent.order_number} (phần ${i + 1}/${numberOfWays})`,
        created_by: parent.created_by,
        parent_order_id: orderId,
      })
      .select()
      .single();

    if (childErr || !child) handleError(childErr ?? { message: "Split failed" }, "splitEqually");

    // Move items for this batch
    if (batches[i].length > 0) {
      const { error: moveErr } = await supabase
        .from("kitchen_order_items")
        .update({ kitchen_order_id: child.id })
        .in("id", batches[i]);
      if (moveErr) handleError(moveErr, "splitEqually.moveItems");
    }

    childOrderIds.push(child.id);
  }

  return { childOrderIds };
}

/**
 * Check if all orders (parent + children) for a table are completed.
 * Used to determine when to release the table.
 */
export async function areAllTableOrdersCompleted(tableId: string): Promise<boolean> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { count } = await supabase
    .from("kitchen_orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("table_id", tableId)
    .not("status", "in", '("completed","cancelled")');

  return (count ?? 0) === 0;
}
