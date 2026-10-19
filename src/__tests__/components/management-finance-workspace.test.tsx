import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
const mocks = vi.hoisted(() => ({workspace:vi.fn(),all:vi.fn()}));
vi.mock('@/lib/contexts',() => ({useAuth:() => ({activeBranchId:'xtb',branches:[{id:'xtb',name:'XTB - Thu ngân'}],hasPermission:() => true,isLoading:false})}));
vi.mock('@/components/shared/report',() => ({ReportTableFrame:({children}:{children:ReactNode}) => <div>{children}</div>}));
vi.mock('@/components/shared/page-header',() => ({PageHeader:({title}:{title:string}) => <h1>{title}</h1>}));
vi.mock('@/components/shared/dialogs/management-finance-dialog',() => ({ManagementFinanceDialog:() => null}));
vi.mock('@/lib/services/supabase/management-finance',() => ({
  getFinanceWorkspace:mocks.workspace,getAllFinanceRows:mocks.all,getFinanceCategories:async () => [],
  saveFinanceCategory:vi.fn(),cancelFinanceDocument:vi.fn(),
}));
import Page from '@/app/(main)/tai-chinh/thu-nhap-chi-phi/page';
const row = {id:'e',code:'CP001',kind:'expense',category_code:'CP1',category_name:'Điện',counterparty:'Điện lực',
  status:'posted',business_date:'2026-10-01',amount:1000,report_amount:600,settled_amount:300,created_by_name:'Admin',
  allocations:[{branch_id:'xtb',branch_name:'XTB',recognition_date:'2026-10-02',amount:600}],
  settlements:[{id:'c',code:'PC001',transaction_date:'2026-10-03',occurred_at:null,performed_by_name:'Nhân viên',
    amount:300,status:'cancelled',payment_method:'bank_transfer',branch_id:'xtb'}]};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({items:[row],total:1,summary:{income:0,expense:600,non_pnl:0},basis:'recognition_date'});
  mocks.all.mockResolvedValue([row]);
});
describe('management finance reporting workspace',() => {
  it('links automatic receipt expenses to their source without offering another payment or separate cancellation',async()=>{
    mocks.workspace.mockResolvedValue({items:[{...row,source_type:'internal_receipt',source_sale_id:'sale-source',source_receipt_id:'receipt-source',can_view_consolidated_cost:false,settled_amount:0,settlements:[]}],total:1,summary:{income:0,expense:600,non_pnl:0}});
    render(<Page/>);
    fireEvent.click(await screen.findByRole('button',{name:'CP001'}));
    expect(screen.getByRole('link',{name:'Phiếu nhận nội bộ'})).toHaveAttribute('href','/hang-hoa/nhap-hang/noi-bo?sale=sale-source&branch=xtb');
    expect(screen.queryByRole('button',{name:'Thanh toán'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Hủy ghi nhận'})).not.toBeInTheDocument();
    expect(screen.queryByText(/Chi phí hợp nhất:/)).not.toBeInTheDocument();
  });
  it('does not display missing consolidated source cost as zero',async()=>{
    mocks.workspace.mockResolvedValue({items:[{...row,source_type:'internal_receipt',source_sale_id:'sale-source',can_view_consolidated_cost:true,consolidated_amount:null}],total:1,summary:{income:0,expense:600,non_pnl:0}});
    render(<Page/>);
    fireEvent.click(await screen.findByRole('button',{name:'CP001'}));
    expect(screen.getByText('Chi phí hợp nhất: Chưa có giá vốn nguồn')).toBeInTheDocument();
  });
  it('opens financial reports in the selected branch and recognition period',async()=>{
    render(<Page/>);
    await screen.findByRole('button',{name:'CP001'});
    fireEvent.change(screen.getByLabelText('Ghi nhận từ ngày'),{target:{value:'2026-09-01'}});
    fireEvent.change(screen.getByLabelText('Đến ngày'),{target:{value:'2026-09-30'}});
    await waitFor(()=>expect(screen.getByRole('button',{name:'Kết quả kinh doanh'})).toHaveAttribute('href','/phan-tich/bao-cao-tai-chinh?preset=custom&from=2026-09-01&to=2026-09-30&view=table&branch=xtb'));
    expect(screen.getByRole('button',{name:'Dòng tiền'})).toHaveAttribute('href','/phan-tich/luong-tien?preset=custom&from=2026-09-01&to=2026-09-30&view=table&branch=xtb');
    await screen.findByRole('button',{name:'CP001'});
  });
  it('keeps income and expense in separate filtered tabs and entry actions',async()=>{
    render(<Page/>);
    await screen.findByRole('button',{name:'CP001'});
    expect(mocks.workspace.mock.calls.at(-1)?.[0]).toMatchObject({kind:'expense'});
    expect(screen.getByRole('button',{name:'Ghi nhận chi phí'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab',{name:'Thu nhập khác'}));
    await waitFor(()=>expect(mocks.workspace.mock.calls.at(-1)?.[0]).toMatchObject({kind:'income'}));
    expect(screen.getByRole('button',{name:'Ghi nhận thu nhập'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Ghi nhận chi phí'})).not.toBeInTheDocument();
  });
  it('retains cancelled settlement history with separate cash dates and readable methods',async () => {
    render(<Page/>);
    fireEvent.click(await screen.findByRole('button',{name:'CP001'}));
    expect(screen.getByText('PC001')).toBeInTheDocument();
    expect(screen.getByText('Chuyển khoản')).toBeInTheDocument();
    expect(screen.getByRole('cell',{name:'XTB - Thu ngân'})).toBeInTheDocument();
    expect(screen.getByRole('cell',{name:'Đã hủy'})).toBeInTheDocument();
    expect(screen.getByText('Ngày chứng từ')).toBeInTheDocument();
    expect(screen.getByText('Thực thu/chi')).toBeInTheDocument();
    expect(screen.getByText('Chi phí ghi nhận')).toBeInTheDocument();
  });
  it('stops reads and disables export for invalid date ranges',async () => {
    render(<Page/>);
    await screen.findByRole('button',{name:'CP001'});
    const before=mocks.workspace.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Ghi nhận từ ngày'),{target:{value:'2099-10-01'}});
    await screen.findByRole('alert');
    expect(mocks.workspace).toHaveBeenCalledTimes(before);
    expect(screen.getByRole('button',{name:'Xuất Excel'})).toBeDisabled();
    expect(screen.queryByRole('button',{name:'CP001'})).not.toBeInTheDocument();
  });
  it('shows source integrity errors rather than crashing the category table',async () => {
    mocks.all.mockResolvedValue([row,row]);
    render(<Page/>);
    fireEvent.click(await screen.findByRole('tab',{name:'Theo khoản mục'}));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Nguồn ghi nhận bị trùng'));
  });
});
