import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';

const mocks=vi.hoisted(()=>({read:vi.fn(),receive:vi.fn(),toast:vi.fn()}));
vi.mock('@/lib/contexts',()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock('@/lib/services',()=>({getPurchaseOrderItems:mocks.read,receivePurchaseOrderPartial:mocks.receive}));
import {PartialReceiveDialog} from '@/components/shared/dialogs/partial-receive-dialog';

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.read.mockResolvedValue([
    {id:'milk',productName:'Sữa hộp',productCode:'MILK',unit:'Hộp',quantity:1200,receivedQuantity:200,remaining:1000,unitPrice:32500},
    {id:'coffee',productName:'Cà phê',productCode:'COFFEE',unit:'Kg',quantity:2.5,receivedQuantity:1,remaining:1.5,unitPrice:100000},
  ]);
  mocks.receive.mockResolvedValue({newStatus:'completed',receivedLines:2});
});
describe('supplier receipt UX',()=>{
  it('does not preselect or post goods on opening and never sums mixed units',async()=>{
    render(<PartialReceiveDialog open onOpenChange={()=>{}} orderId="po" orderCode="PN-TEST"/>);
    const milk=await screen.findByLabelText('Nhận lần này Sữa hộp');
    expect(milk).toBeDisabled();
    expect(screen.getByRole('button',{name:'Xác nhận nhập'})).toBeDisabled();
    expect(screen.queryByText('SL nhận')).not.toBeInTheDocument();
    expect(screen.getByText('Mặt hàng còn thiếu')).toBeInTheDocument();
    expect(mocks.receive).not.toHaveBeenCalled();
  });
  it('fills quantities for review, formats separators, and posts only after confirmation',async()=>{
    render(<PartialReceiveDialog open onOpenChange={()=>{}} orderId="po" orderCode="PN-TEST"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Điền số còn lại'}));
    expect(screen.getByLabelText('Nhận lần này Sữa hộp')).toHaveValue('1,000');
    expect(mocks.receive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Xác nhận nhập (2 dòng)'}));
    await waitFor(()=>expect(mocks.receive).toHaveBeenCalledWith('po',[{itemId:'milk',receiveQty:1000},{itemId:'coffee',receiveQty:1.5}]));
  });
});
