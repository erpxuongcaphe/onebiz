import type { Product, ProductVariant } from "@/lib/types";

/** A lone, unconfigured Default row is not a sellable packaging choice. */
export function isUnconfiguredDefaultVariant(
  product: Pick<Product, "sellPrice">,
  variants: ProductVariant[],
): boolean {
  if (variants.length !== 1 || !(product.sellPrice > 0)) return false;

  const variant = variants[0];
  return (
    variant.isDefault &&
    variant.name.trim().toLowerCase() === "default" &&
    variant.sellPrice === 0 &&
    !variant.sku &&
    !variant.barcode &&
    !variant.packagingType &&
    !variant.packagingSize &&
    !variant.bomCode &&
    !variant.weight &&
    variant.unitCount <= 1
  );
}
