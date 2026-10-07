/** A stock input must never become a POS menu item, including from old caches. */
export function isFnbMenuSaleItem(product: {
  inventory_role?: string | null;
  is_fnb_stock_item?: boolean;
}): boolean {
  return product.inventory_role === "fnb_menu_item" && product.is_fnb_stock_item !== true;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
}

export function matchesFnbMenuSearch(product: { name: string; code: string }, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const text = normalize(`${product.name} ${product.code}`);
  return words.every(word => text.includes(word));
}
