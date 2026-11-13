import {describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
const mocks=vi.hoisted(()=>({performers:vi.fn().mockResolvedValue([]),permission:vi.fn().mockReturnValue(true),prepare:vi.fn().mockReturnValue([]),preview:vi.fn().mockResolvedValue([])}));
vi.mock('@/lib/contexts',()=>({useAuth:()=>({activeBranchId:'branch',branches:[{id:'branch',name:'Kho Tổng'},{id:'premium',name:'Premium'}],hasPermissionAtBranch:mocks.permission,hasAssignedBranchAccess:()=>true})}));
vi.mock('@/lib/services/supabase/cash-timing',()=>({getCashPerformers:mocks.performers}));
vi.mock('@/lib/services/supabase/finance-import',()=>({prepareFinanceImport:mocks.prepare,previewFinanceImport:mocks.preview,commitFinanceImport:vi.fn()}));
vi.mock('@/components/shared/dialogs/import-excel-dialog',()=>({ImportExcelDialog:({instructions,uploadContent,preparePreview}:{instructions:ReactNode;uploadContent:ReactNode;preparePreview:(rows:unknown[])=>Promise<void>})=><div>{instructions}{uploadContent}<button onClick={()=>void preparePreview([])}>Xem trước giả</button></div>}));
import {FinanceImportDialog} from '@/components/shared/dialogs/finance-import-dialog';

describe('financial import guidance',()=>{
  it('explains immutable source identities and separates trade payment from recognition',()=>{
    render(<FinanceImportDialog open onOpenChange={vi.fn()} categories={[]} onFinished={vi.fn()}/>);
    expect(screen.getByText(/cùng mã nhưng khác nội dung sẽ bị chặn, không ghi đè/)).toBeInTheDocument();
    expect(screen.getByText(/không ghi thêm doanh thu\/chi phí lần nữa/)).toBeInTheDocument();
    expect(screen.getByText(/không đổi mã để gửi lại/)).toBeInTheDocument();
    expect(screen.queryByText(/Mã đã có sẽ được cập nhật/)).not.toBeInTheDocument();
  });
  it('uses the branch selected in the finance screen for permissions and import context',async()=>{
    mocks.performers.mockClear(); mocks.permission.mockClear();
    render(<FinanceImportDialog branchId="premium" open onOpenChange={vi.fn()} categories={[]} onFinished={vi.fn()}/>);
    expect(screen.getByText('Premium')).toBeInTheDocument();
    expect(mocks.permission).toHaveBeenCalledWith('finance.create_transaction','premium');
    await waitFor(()=>expect(mocks.performers).toHaveBeenCalledWith('premium'));
    fireEvent.click(screen.getByRole('button',{name:'Xem trước giả'}));
    await waitFor(()=>expect(mocks.prepare).toHaveBeenCalledWith([], 'premium', '', []));
  });
});
