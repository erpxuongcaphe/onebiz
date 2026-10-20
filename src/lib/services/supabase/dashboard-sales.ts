import { z } from 'zod';
import { getClient, handleError } from './base';
import type { SalesDashboard, SalesGrain } from '@/lib/dashboard-sales';

const amount = z.number().finite();
const schema = z.object({
  sales: amount, discounts: amount, returns: amount, orders: amount,
  received: amount, refunded: amount, collected: amount,
  methods: z.record(z.string(), amount),
  buckets: z.array(z.object({ key: z.string(), sales: amount, orders: amount })),
  modes: z.array(z.object({ mode: z.string(), sales: amount, orders: amount })),
});

export async function getSalesDashboard(
  branchId: string | undefined, from: string, to: string, grain: SalesGrain,
): Promise<SalesDashboard> {
  const { data, error } = await getClient().rpc('get_operational_sales_dashboard' as never, {
    p_branch_id: branchId ?? null, p_from: from, p_to: to, p_grain: grain,
  } as never);
  if (error) handleError(error, 'getSalesDashboard');
  const result = schema.safeParse(data);
  if (!result.success) throw new Error('Dữ liệu tổng quan chưa đầy đủ.');
  return result.data;
}
