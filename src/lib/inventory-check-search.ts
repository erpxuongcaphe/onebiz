export function buildInventoryCheckProductFilter(
  searchTerm: string,
  isOutlet: boolean,
): string | null {
  const term = searchTerm.replace(/[(),%]/g, " ").trim();
  if (!term) return null;

  const groups = [
    "or(inventory_role.is.null,inventory_role.neq.fnb_menu_item)",
    ...(isOutlet ? [] : ["or(product_type.eq.nvl,has_bom.is.false)"]),
    `or(code.ilike.%${term}%,name.ilike.%${term}%,barcode.ilike.%${term}%)`,
  ];

  return `and(${groups.join(",")})`;
}
