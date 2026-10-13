import {describe,expect,it,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import type {ReactNode} from 'react';
vi.mock('@/lib/contexts',()=>({useAuth:()=>({activeBranchId:'branch',branches:[{id:'branch',name:'Kho Tổng'}],hasPermission:()=>true})}));
vi.mock('@/lib/services/supabase/cash-timing',()=>({getCashPerformers:vi.fn().mockResolvedValue([])}));
vi.mock('@/components/shared/dialogs/import-excel-dialog',()=>({ImportExcelDialog:({instructions}:{instructions:ReactNode})=><div>{instructions}</div>}));
import {FinanceImportDialog} from '@/components/shared/dialogs/finance-import-dialog';

describe('financial import guidance',()=>{
  it('explains immutable source identities and separates trade payment from recognition',()=>{
    render(<FinanceImportDialog open onOpenChange={vi.fn()} categories={[]} onFinished={vi.fn()}/>);
    expect(screen.getByText(/cùng mã nhưng khác nội dung sẽ bị chặn, không ghi đè/)).toBeInTheDocument();
    expect(screen.getByText(/không ghi thêm doanh thu\/chi phí lần nữa/)).toBeInTheDocument();
    expect(screen.getByText(/không đổi mã để gửi lại/)).toBeInTheDocument();
    expect(screen.queryByText(/Mã đã có sẽ được cập nhật/)).not.toBeInTheDocument();
  });
});
