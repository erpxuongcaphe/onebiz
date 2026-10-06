import {beforeEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock('@/lib/services/supabase/base', () => ({getClient: () => ({rpc: mocks.rpc}), handleError: (e: Error) => {throw e;}}));
import {getAllFinanceRows, getFinanceWorkspace, saveFinanceDocument, settleFinanceDocument, cancelFinanceDocument} from '@/lib/services/supabase/management-finance';
const filters = {from: '2026-09-01', to: '2026-09-30', branchId: 'xtb'};
const workspace = (items: unknown[], total = items.length) => ({data: {items, total, summary: {income: 0, expense: 0, non_pnl: 0}}, error: null});
beforeEach(() => mocks.rpc.mockReset());
describe('management finance service', () => {
  it('preserves recognition-date and branch filters for the server snapshot', async () => {
    mocks.rpc.mockResolvedValue(workspace([]));
    await getFinanceWorkspace({...filters, kind: 'expense', search: '  rent  '});
    expect(mocks.rpc).toHaveBeenCalledWith('get_management_finance_workspace', expect.objectContaining({p_branch_id: 'xtb', p_date_from: filters.from, p_date_to: filters.to, p_search: 'rent', p_kind: 'expense'}));
  });
  it('sends recognition and immediate cash in one call with a caller-owned retry key', async () => {
    const payload = {categoryId: 'leaf', businessDate: filters.from, amount: 100, counterparty: 'Landlord', allocations: [{branchId: 'xtb', recognitionDate: filters.from, amount: 100}]};
    mocks.rpc.mockResolvedValue({data: {event: {id: 'event'}, cash: null}, error: null});
    await saveFinanceDocument('request-1', payload);
    expect(mocks.rpc).toHaveBeenCalledWith('save_management_finance_document', {p_request_id: 'request-1', p_payload: payload});
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('never retries a failed settlement using a standalone manual cash RPC', async () => {
    mocks.rpc.mockResolvedValue({data: null, error: new Error('denied')});
    await expect(settleFinanceDocument('event', 'same-key', {branchId: 'xtb', performedBy: 'person', amount: 10, paymentMethod: 'cash', transactionDate: filters.to, occurredAt: '2026-09-30T01:00:00Z'})).rejects.toThrow('denied');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('accepts the void RPC empty response, not an empty data response for reads', async () => {
    mocks.rpc.mockResolvedValue({data: null, error: null});
    await cancelFinanceDocument('event', ' correction ');
    await expect(getFinanceWorkspace(filters)).rejects.toThrow('chưa trả về');
  });
  it('exports all pages, not only the visible table', async () => {
    mocks.rpc.mockResolvedValueOnce(workspace(Array.from({length: 200}, (_, i) => ({id: String(i)})), 201));
    mocks.rpc.mockResolvedValueOnce(workspace([{id: '200'}], 201));
    expect(await getAllFinanceRows(filters)).toHaveLength(201);
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({p_page: 1, p_page_size: 200, p_branch_id: 'xtb'});
  });
  it('fails closed on an incomplete page', async () => {
    mocks.rpc.mockResolvedValue(workspace([], 1));
    await expect(getAllFinanceRows(filters)).rejects.toThrow('Chưa tải đủ');
  });
  it('rejects moving totals and duplicated IDs rather than exporting misleading data', async () => {
    mocks.rpc.mockResolvedValueOnce(workspace([{id: '1'}], 2)).mockResolvedValueOnce(workspace([{id: '2'}], 3));
    await expect(getAllFinanceRows(filters)).rejects.toThrow('đã thay đổi');
    mocks.rpc.mockResolvedValueOnce(workspace([{id: '1'}], 2)).mockResolvedValueOnce(workspace([{id: '1'}], 2));
    await expect(getAllFinanceRows(filters)).rejects.toThrow('đã thay đổi');
  });
});
