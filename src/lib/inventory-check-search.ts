export function buildInventoryCheckProductFilter(
  searchTerm: string,
  isOutlet: boolean,
): string | null {
  const term = searchTerm.replace(/[(),%]/g, " ").trim();
  if (!term) return null;

  const groups = [
    "or(inventory_role.is.null,inventory_role.neq.fnb_menu_item)",
    ...(isOutlet ? ["product_type.eq.sku", "code.not.ilike.WS%", "name.not.ilike.WS%", "name.not.ilike.FECA%"] : ["or(product_type.eq.nvl,has_bom.is.false)"]),
    `or(code.ilike.%${term}%,name.ilike.%${term}%,barcode.ilike.%${term}%)`,
  ];

  return `and(${groups.join(",")})`;
}
