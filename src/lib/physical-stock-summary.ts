import type { Product } from "@/lib/types";

/** Stored stock only: prepared goods have stock; made-to-order drinks do not. */
export function summarizePhysicalStock(
  products: Pick<Product, "stock" | "branchStock" | "unit" | "channel" | "isFnbStockItem">[],
  branchScoped: boolean,
): { unit: string; quantity: number }[] {
  const totals = new Map<string, number>();
  for (const product of products) {
    if (product.channel === "fnb" && !product.isFnbStockItem) continue;
    const unit = product.unit?.trim() || "ĐVT chưa đặt";
    const quantity = branchScoped ? product.branchStock ?? 0 : product.stock;
    totals.set(unit, (totals.get(unit) ?? 0) + quantity);
  }
  return [...totals].map(([unit, quantity]) => ({ unit, quantity }));
}
