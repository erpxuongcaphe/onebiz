import type { SalesReturnRow } from "@/lib/services/supabase/sales-reports";
import type { TopProductRevenue } from "@/lib/services/supabase/analytics";

export type ReconciledProductSales = TopProductRevenue & {
  returnedValue: number;
  netRevenue: number;
};

function productKey(productId: string, name: string): string {
  const normalizedName = name.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
  return `${productId}\u001f${normalizedName}`;
}

export function reconcileProductSales(
  sales: TopProductRevenue[],
  returns: Pick<SalesReturnRow, "productId" | "productName" | "returnValue">[],
): ReconciledProductSales[] {
  const products = new Map<string, ReconciledProductSales>();
  const codeByProductId = new Map<string, string | undefined>();

  for (const sale of sales) {
    const key = productKey(sale.productId, sale.name);
    const current = products.get(key);
    if (current) {
      current.qty += sale.qty;
      current.revenue += sale.revenue;
    } else {
      products.set(key, {
        ...sale,
        returnedValue: 0,
        netRevenue: 0,
      });
    }
    if (sale.code) codeByProductId.set(sale.productId, sale.code);
  }

  for (const returned of returns) {
    const key = productKey(returned.productId, returned.productName);
    const current = products.get(key) ?? {
      productId: returned.productId,
      name: returned.productName,
      code: codeByProductId.get(returned.productId),
      qty: 0,
      revenue: 0,
      returnedValue: 0,
      netRevenue: 0,
    };
    current.returnedValue += returned.returnValue;
    products.set(key, current);
  }

  return Array.from(products.values(), (product) => ({
    ...product,
    netRevenue: product.revenue - product.returnedValue,
  }));
}
