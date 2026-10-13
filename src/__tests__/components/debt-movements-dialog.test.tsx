import {beforeEach,describe,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
const mocks=vi.hoisted(()=>({get:vi.fn(),export:vi.fn(),guard:vi.fn()}));
vi.mock('@/lib/services/supabase/debt-movements',()=>({getDebtMovements:mocks.get}));
vi.mock('@/lib/utils/export',()=>({exportToExcel:mocks.export}));
vi.mock('@/lib/permissions/use-permission',()=>({usePermissions:()=>({hasPermission:()=>true})}));
vi.mock('@/components/shared/report',()=>({ReportTableFrame:({children}:{children:ReactNode})=><div>{children}</div>}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({open,children,protectUnsavedChanges}:{open:boolean;children:ReactNode;protectUnsavedChanges?:boolean})=>{mocks.guard(protectUnsavedChanges);return open?<div>{children}</div>:null;},DialogContent:({children}:{children:ReactNode})=><div>{children}</div>,DialogHeader:({children}:{children:ReactNode})=><div>{children}</div>,DialogTitle:({children}:{children:ReactNode})=><h2>{children}</h2>}));
import {DebtMovementsDialog} from '@/components/shared/dialogs/debt-movements-dialog';
const row={key:'invoice:1',id:'1',kind:'invoice',code:'HD1',date:'2026-10-01',created_at:'2026-10-01T00:00:00Z',status:'completed',amount:100,delta:100,balance:110,note:'Original',unmapped:false};
const report={basis:'current_effective_documents',opening:10,increase:100,decrease:0,closing:110,current_net:110,difference:0,unmapped:0,total:2,items:[row,{...row,key:'invoice:2',id:'2',code:'HD-HUY',status:'cancelled',delta:0}]};
const props={open:true,onOpenChange:vi.fn(),mode:'customer' as const,partyId:'party',partyName:'Customer',branchId:'branch',branchLabel:'Kho Tổng'};
beforeEach(()=>{vi.clearAllMocks();mocks.get.mockResolvedValue(report);mocks.export.mockResolvedValue(undefined);});
describe('debt movement history UI',()=>{
  it('does not treat read-only report filters as unsaved business data',async()=>{
    render(<DebtMovementsDialog {...props}/>);
    await screen.findByRole('button',{name:'HD1',exact:true});
    fireEvent.change(screen.getByLabelText('Tìm biến động'),{target:{value:'HD1'}});
    expect(mocks.guard).toHaveBeenLastCalledWith(false);
  });
  it('keeps cancelled rows accessible with zero movement and exports full filtered source',async()=>{
    render(<DebtMovementsDialog {...props}/>);
    await screen.findByRole('button',{name:'HD-HUY'});
    expect(screen.getByRole('cell',{name:'Đã hủy'})).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Trạng thái biến động'),{target:{value:'cancelled'}});
    expect(screen.queryByRole('button',{name:'HD1',exact:true})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Xuất Excel'}));
    await waitFor(()=>expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0]).toEqual([expect.objectContaining({code:'HD-HUY',increase:0,decrease:0,balance:110,opening:10,closing:110})]);
  });
  it('does not silently fill missing history into opening balance',async()=>{
    mocks.get.mockResolvedValue({...report,difference:50,unmapped:1});
    render(<DebtMovementsDialog {...props}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tự bù chênh vào đầu kỳ');
  });
  it('requires a branch rather than mixing chain balances',async()=>{
    render(<DebtMovementsDialog {...props} branchId={undefined}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Chọn một chi nhánh');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
