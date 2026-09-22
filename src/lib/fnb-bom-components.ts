import type { Product } from "@/lib/types";

type FnbComponentCandidate = Pick<
  Product,
  "productType" | "channel" | "inventoryRole"
>;

/**
 * F&B menu items consume stockable Retail SKUs at the selling branch.
 * A legacy SKU without an explicit channel is also a Retail stock item in the
 * generated inventory_role model; only channel=fnb represents a menu item.
 */
export function isSelectableFnbBomComponent(
  product: FnbComponentCandidate,
): boolean {
  return (
    product.productType === "sku" &&
    (product.inventoryRole === "fnb_stock_item" || product.channel !== "fnb")
  );
}
