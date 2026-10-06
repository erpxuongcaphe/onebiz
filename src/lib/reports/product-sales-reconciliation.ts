import type { SalesReturnRow } from "@/lib/services/supabase/sales-reports";
import type { TopProductRevenue } from "@/lib/services/supabase/analytics";

export type ReconciledProductSales = TopProductRevenue & {
  returnedValue: number;
  netRevenue: number;
  returnedQty: number;
  netQty: number;
};

function productKey(productId: string, name: string): string {
  const normalizedName = name.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
  return `${productId}\u001f${normalizedName}`;
}

export function reconcileProductSales(
  sales: TopProductRevenue[],
  returns: (Pick<SalesReturnRow, "productId" | "productName" | "returnValue"> & Partial<Pick<SalesReturnRow, "quantity" | "unit">>)[],
): ReconciledProductSales[] {
  const products = new Map<string, ReconciledProductSales>();
  const codeByProductId = new Map<string, string | undefined>();
  const saleKeys = new Map<string, Set<string>>();

  for (const sale of sales) {
    const baseKey = productKey(sale.productId, sale.name);
    const key = `${baseKey}\u001f${sale.unit ?? ""}`;
    const keys = saleKeys.get(baseKey) ?? new Set<string>();
    keys.add(key);
    saleKeys.set(baseKey, keys);
    const current = products.get(key);
    if (current) {
      current.qty += sale.qty;
      current.revenue += sale.revenue;
      current.discountAmount = (current.discountAmount ?? 0) + (sale.discountAmount ?? 0);
    } else {
      products.set(key, {
        ...sale,
        returnedValue: 0,
        netRevenue: 0,
        returnedQty: 0,
        netQty: 0,
      });
    }
    if (sale.code) codeByProductId.set(sale.productId, sale.code);
  }

  for (const returned of returns) {
    const baseKey = productKey(returned.productId, returned.productName);
    const candidates = saleKeys.get(baseKey);
    const key = returned.unit
      ? `${baseKey}\u001f${returned.unit}`
      : candidates?.size === 1 ? [...candidates][0] : `${baseKey}\u001f`;
    const current = products.get(key) ?? {
      productId: returned.productId,
      name: returned.productName,
      code: codeByProductId.get(returned.productId),
      unit: returned.unit,
      qty: 0,
      revenue: 0,
      returnedValue: 0,
      netRevenue: 0,
      returnedQty: 0,
      netQty: 0,
    };
    current.returnedValue += returned.returnValue;
    current.returnedQty += returned.quantity ?? 0;
    products.set(key, current);
  }

  return Array.from(products.values(), (product) => ({
    ...product,
    netRevenue: product.revenue - product.returnedValue,
    netQty: product.qty - product.returnedQty,
  }));
}
