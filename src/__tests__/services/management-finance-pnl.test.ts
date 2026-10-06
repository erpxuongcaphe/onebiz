import {describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock('@/lib/services/supabase/base', () => ({getClient: () => ({rpc: mocks.rpc}), getCurrentTenantId: async () => 'tenant', handleError: (e: Error) => {throw e;}}));
import {getProfitAndLoss} from '@/lib/services/supabase/reports';
describe('recognized other income in P&L', () => {
  it('includes other income in result, without changing sales or gross profit', async () => {
    const row = {revenue: 100, delivery_fee: 0, cogs: 30, operating_expense: 20, other_income: 10, legacy_cash_expense: 5, cogs_complete: true};
    mocks.rpc.mockResolvedValue({data: {current: row, previous: {...row, other_income: 0}}, error: null});
    const report = await getProfitAndLoss('xtb', {from: '2026-09-01', to: '2026-09-30'});
    expect(report.current).toMatchObject({revenue: 100, grossProfit: 70, netProfit: 60, otherIncome: 10, legacyCashExpense: 5});
    expect(report.previous.netProfit).toBe(50);
  });
});
