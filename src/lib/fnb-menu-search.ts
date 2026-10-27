import { rankSearchMatch } from "@/lib/smart-search";

/** A stock input must never become a POS menu item, including from old caches. */
export function isFnbMenuSaleItem(product: {
  inventory_role?: string | null;
  is_fnb_stock_item?: boolean;
}): boolean {
  return product.inventory_role === "fnb_menu_item" && product.is_fnb_stock_item !== true;
}

export function matchesFnbMenuSearch(product: { name: string; code: string }, query: string): boolean {
  return !query.trim() || rankSearchMatch(product.name, [product.code], query) !== null;
}
