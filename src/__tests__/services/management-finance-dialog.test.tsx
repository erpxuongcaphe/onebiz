import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
const mocks = vi.hoisted(() => ({save: vi.fn(), settle: vi.fn(), success: vi.fn(), close: vi.fn()}));
vi.mock('@/lib/contexts', () => ({useAuth: () => ({tenant: {id: 'tenant'}, user: {id: 'user'}, currentBranch: {id: 'xtb'}, branches: [{id: 'xtb', name: 'XTB'}]})}));
vi.mock('@/lib/hooks/use-durable-form-draft', () => ({useDurableFormDraft: () => ({clearDraft: vi.fn()})}));
vi.mock('@/lib/services/supabase/cash-timing', () => ({getCashPerformers: async () => [{id: 'person', name: 'Employee'}]}));
vi.mock('@/lib/services/supabase/management-finance', async importOriginal => ({...(await importOriginal<object>()), saveFinanceDocument: mocks.save, settleFinanceDocument: mocks.settle}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({open, children}: {open: boolean; children: ReactNode}) => open ? <div>{children}</div> : null,
  DialogContent: ({children}: {children: ReactNode}) => <div>{children}</div>,
  DialogHeader: ({children}: {children: ReactNode}) => <div>{children}</div>,
  DialogTitle: ({children}: {children: ReactNode}) => <h2>{children}</h2>,
  DialogFooter: ({children}: {children: ReactNode}) => <div>{children}</div>,
}));
vi.mock('@/components/ui/searchable-select', () => ({SearchableSelect: ({value, onValueChange, options, disabled}: {value: string; onValueChange: (v: string) => void; options: Array<{value: string; label: string}>; disabled: boolean}) => <select disabled={disabled} value={value} onChange={e => onValueChange(e.target.value)}><option value="">Choose</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}));
import {ManagementFinanceDialog} from '@/components/shared/dialogs/management-finance-dialog';
const category = {id: 'leaf', code: 'CP-VH-DIEN', name: 'Electricity', kind: 'expense' as const, parent_id: 'group', is_group: false};
const props = {open: true, onOpenChange: mocks.close, onSuccess: mocks.success, categories: [category]};
beforeEach(() => {vi.clearAllMocks(); localStorage.clear(); mocks.save.mockResolvedValue({event: {id: 'event'}, cash: null});});
async function fillUnpaid() {
  render(<ManagementFinanceDialog {...props}/>);
  fireEvent.change(screen.getByLabelText('Khoản mục'), {target: {value: 'leaf'}});
  fireEvent.change(screen.getByLabelText('Tổng số tiền'), {target: {value: '100'}});
  fireEvent.change(screen.getByLabelText('Đối tượng'), {target: {value: 'Utility'}});
}
describe('management finance dialog', () => {
  it('records unpaid expense without creating cash and synchronizes the single allocation', async () => {
    await fillUnpaid();
    fireEvent.click(screen.getByRole('button', {name: 'Lưu'}));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][1]).toMatchObject({amount: 100, counterparty: 'Utility', allocations: [{branchId: 'xtb', amount: 100}]});
    expect(mocks.save.mock.calls[0][1]).not.toHaveProperty('payment');
    expect(localStorage.getItem('onebiz_finance_request_v1:tenant:user:new')).toBeNull();
  });
  it('persists before dispatch and replays the identical payload after an uncertain network result', async () => {
    mocks.save.mockImplementationOnce(() => {
      expect(localStorage.getItem('onebiz_finance_request_v1:tenant:user:new')).not.toBeNull();
      return Promise.reject(new Error('Network timeout'));
    });
    await fillUnpaid(); fireEvent.click(screen.getByRole('button', {name: 'Lưu'}));
    await screen.findByText('Network timeout');
    expect(screen.getByLabelText('Tổng số tiền')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {name: 'Thử lại'}));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
  });
  it('restores an unresolved request across a remount instead of issuing a new document', async () => {
    const pending = {requestId: 'retained-key', payload: {categoryId: 'leaf', amount: 100, allocations: [{branchId: 'xtb', amount: 100}]}};
    localStorage.setItem('onebiz_finance_request_v1:tenant:user:new', JSON.stringify(pending));
    render(<ManagementFinanceDialog {...props}/>);
    fireEvent.click(await screen.findByRole('button', {name: 'Thử lại'}));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith(pending.requestId, pending.payload);
  });
});
