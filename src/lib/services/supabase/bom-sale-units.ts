import { getClient, getCurrentTenantId, handleError } from "./base";
interface SaleLine { invoiceId: string; productId: string; productName: string; qtySold: number; revenue: number }
interface UnitRow { id: string; invoice_id: string; product_id: string; product_name: string; quantity: number | string; total: number | string; unit: string | null }
interface UnitQuery extends PromiseLike<{ data: UnitRow[] | null; error: { message: string } | null }> {
  select(value: string): UnitQuery; eq(key: string, value: string): UnitQuery; in(key: string, values: string[]): UnitQuery;
  order(key: string, value: { ascending: boolean }): UnitQuery; range(from: number, to: number): UnitQuery;
}
const signature = (row: SaleLine) => JSON.stringify([row.invoiceId, row.productId, row.productName, row.qtySold, row.revenue]);
/** Match historical quantity denominators without guessing between repeated bill lines. */
export async function getBomSaleUnits(lines: SaleLine[]): Promise<(string | null)[]> {
  if (!lines.length) return [];
  const tenant = await getCurrentTenantId();
  const from = getClient().from.bind(getClient()) as unknown as (table: string) => UnitQuery;
  const seen = new Set<string>(), units = new Map<string, Set<string | null>>();
  for (let start = 0; start < lines.length; start += 100) {
    const batch = lines.slice(start, start + 100);
    const invoiceIds = [...new Set(batch.map(row => row.invoiceId))], productIds = [...new Set(batch.map(row => row.productId))];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await from("invoice_items_scoped").select("id,invoice_id,product_id,product_name,quantity,total,unit,invoices!inner(tenant_id)")
        .eq("invoices.tenant_id", tenant).in("invoice_id", invoiceIds).in("product_id", productIds).order("id", { ascending: true }).range(offset, offset + 499);
      if (error) handleError(error, "getBomSaleUnits");
      for (const row of data ?? []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const key = signature({ invoiceId: row.invoice_id, productId: row.product_id, productName: row.product_name, qtySold: Number(row.quantity), revenue: Number(row.total) });
        const values = units.get(key) ?? new Set<string | null>();
        values.add(row.unit?.trim() || null); units.set(key, values);
      }
      if (!data || data.length < 500) break;
    }
  }
  return lines.map(row => {
    const values = units.get(signature(row));
    return values?.size === 1 ? [...values][0] : null;
  });
}
