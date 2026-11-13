import { z } from 'zod';
import { getClient, handleError } from './base';
import type { SalesDashboard, SalesGrain } from '@/lib/dashboard-sales';

const amount = z.number().finite();
const schema = z.object({
  sales: amount, discounts: amount, returns: amount, orders: amount, internal_net: amount.optional(),
  received: amount, refunded: amount, collected: amount,
  methods: z.record(z.string(), amount),
  buckets: z.array(z.object({ key: z.string(), sales: amount, orders: amount })),
  modes: z.array(z.object({ mode: z.string(), sales: amount, orders: amount })),
});

const receivableSchema = z.object({
  amount, invoice_count: amount, missing_count: amount,
});

const collectionPart = z.object({ net: amount, received: amount, refunded: amount, methods: z.record(z.string(), amount) });
const collectionSchema = z.object({
  internal: collectionPart, external: collectionPart,
  total: z.object({ net: amount, received: amount, refunded: amount }),
});
export type CollectionReconciliation = z.infer<typeof collectionSchema>;

export async function getCollectionReconciliation(branchId: string | undefined, day: string): Promise<CollectionReconciliation> {
  const { data, error } = await getClient().rpc('get_dashboard_collection_reconciliation' as never, {
    p_branch_id: branchId ?? null, p_day: day,
  } as never);
  if (error) handleError(error, 'getCollectionReconciliation');
  const result = collectionSchema.safeParse(data);
  if (!result.success) throw new Error('Dữ liệu đối chiếu tiền thu chưa đầy đủ.');
  return result.data;
}

export async function getSalesDayReceivable(branchId: string | undefined, day: string) {
  const { data, error } = await getClient().rpc('get_sales_day_invoice_receivable' as never, {
    p_branch_id: branchId ?? null, p_day: day,
  } as never);
  if (error) handleError(error, 'getSalesDayReceivable');
  const result = receivableSchema.safeParse(data);
  if (!result.success) throw new Error('Dữ liệu công nợ chưa đầy đủ.');
  return result.data;
}

export async function getSalesDashboard(
  branchId: string | undefined, from: string, to: string, grain: SalesGrain,
): Promise<SalesDashboard> {
  const allBranchDay = !branchId && from === to && grain === 'hour';
  const { data, error } = allBranchDay
    ? await getClient().rpc('get_dashboard_all_branch_day' as never, { p_day: from } as never)
    : await getClient().rpc('get_operational_sales_dashboard' as never, { p_branch_id: branchId ?? null, p_from: from, p_to: to, p_grain: grain } as never);
  if (error) handleError(error, 'getSalesDashboard');
  const result = schema.safeParse(data);
  if (!result.success || (allBranchDay && result.data.internal_net === undefined)) throw new Error('Dữ liệu tổng quan chưa đầy đủ.');
  return result.data;
}
