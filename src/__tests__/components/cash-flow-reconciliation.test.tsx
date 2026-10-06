import {describe,it,expect,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import type {ReactNode} from 'react';
import {reconcileCashFlow} from '@/lib/utils/finance-report-reconciliation';
import {CashFlowReconciliationTable} from '@/components/shared/report/cash-flow-reconciliation';
vi.mock('@/components/ui/dialog',() => ({
  Dialog:({open,children}:{open:boolean;children:ReactNode}) => open ? <div role="dialog">{children}</div> : null,
  DialogContent:({children}:{children:ReactNode}) => <div>{children}</div>,
  DialogHeader:({children}:{children:ReactNode}) => <div>{children}</div>,
  DialogTitle:({children}:{children:ReactNode}) => <h2>{children}</h2>,
}));
const report = reconcileCashFlow([
  {id:'a',code:'PT001',date:'2026-10-01',type:'receipt',typeName:'Thu',category:'Bán hàng',amount:100,counterparty:'Customer',createdBy:'admin',branchName:'XTB',performedByName:'Employee'},
  {id:'b',code:'PC001',date:'2026-10-02',type:'payment',typeName:'Chi',category:'Unknown',amount:30,counterparty:'Supplier',createdBy:'admin'},
],[]);
describe('cash-flow source table',() => {
  it('filters sources by activity without changing period totals',() => {
    render(<CashFlowReconciliationTable report={report}/>);
    fireEvent.change(screen.getByLabelText('Hoạt động'),{target:{value:'unclassified'}});
    expect(screen.queryByRole('button',{name:'PT001'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'PC001'})).toBeInTheDocument();
    expect(screen.getByText('Tổng kỳ')).toBeInTheDocument();
  });
  it('searches source details and opens the document without writing data',() => {
    render(<CashFlowReconciliationTable report={report}/>);
    fireEvent.change(screen.getByLabelText('Mã phiếu / đối tượng'),{target:{value:'Employee'}});
    expect(screen.queryByRole('button',{name:'PC001'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'PT001'}));
    expect(screen.getByRole('dialog')).toHaveTextContent('Phiếu PT001');
    expect(screen.getByRole('dialog')).toHaveTextContent('Ngày hạch toán');
    expect(screen.getByRole('dialog')).toHaveTextContent('Employee');
  });
});
