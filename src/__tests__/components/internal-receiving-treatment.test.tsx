import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {InternalReceivingOrder} from '@/lib/services/supabase/internal-receiving';

const mocks=vi.hoisted(()=>({read:vi.fn(),receive:vi.fn(),params:'branch=xtb&sale=sale-source'}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(mocks.params)}));
vi.mock('@/lib/contexts',()=>({useBranchFilter:()=>({activeBranchId:'warehouse',currentBranch:{id:'warehouse',name:'Kho Tổng'},isReady:true,branches:[{id:'warehouse',name:'Kho Tổng'},{id:'xtb',name:'Tư Búa'}]})}));
vi.mock('@/lib/permissions/use-permission',()=>({usePermissions:()=>({hasPermission:()=>true})}));
vi.mock('@/lib/hooks/use-product-uom',()=>({useProductUom:()=>({map:new Map(),error:null})}));
vi.mock('@/lib/services/supabase/internal-receiving',()=>({getInternalReceivingWorkspace:mocks.read,receiveInternalSale:mocks.receive}));
import Page from '@/app/(main)/hang-hoa/nhap-hang/noi-bo/page';

const order:InternalReceivingOrder={id:'sale-source',code:'BNB-FIXTURE',createdAt:'2026-10-19T08:00:00Z',fromBranch:'Kho Tổng',invoiceId:'invoice',policyVersion:1,receipts:[],items:[
  {id:'milk',productId:'milk-case',code:'SKU-MILK-CASE',name:'Sữa thùng',unit:'Thùng',dispatched:2,received:0,treatment:'stock',receivingProductId:'milk-box',receivingProductCode:'SKU-MILK-BOX',receivingFactor:12,receivingUnit:'Hộp'},
  {id:'tool',productId:'tool',code:'SKU-TOOL',name:'Vật tư vận hành',unit:'Cái',dispatched:3,received:0,treatment:'expense'},
]};
beforeEach(()=>{vi.clearAllMocks();mocks.params='branch=xtb&sale=sale-source';mocks.read.mockResolvedValue([order]);mocks.receive.mockResolvedValue({receiptId:'new-receipt'});});

describe('internal receiving treatment',()=>{
  it('opens the permitted source branch locally without changing the POS branch',async()=>{
    render(<Page/>);
    await screen.findByText('Ghi chi phí vận hành');
    expect(mocks.read).toHaveBeenCalledWith('xtb');
    expect(mocks.read).not.toHaveBeenCalledWith('warehouse');
    expect(screen.getByText('SKU-MILK-BOX · 1 Thùng = 12 Hộp')).toBeInTheDocument();
    expect(screen.getByText('Nhập tồn',{selector:'span'})).toBeInTheDocument();
  });
  it('submits physical source quantities, leaving cost and unit conversion authority on the server',async()=>{
    render(<Page/>);
    await screen.findByText('Ghi chi phí vận hành');
    fireEvent.change(screen.getByLabelText('Thực nhận Sữa thùng'),{target:{value:'1'}});
    fireEvent.change(screen.getByLabelText('Thực nhận Vật tư vận hành'),{target:{value:'2'}});
    fireEvent.click(screen.getByRole('button',{name:'Xác nhận thực nhận'}));
    await waitFor(()=>expect(mocks.receive).toHaveBeenCalledWith(expect.objectContaining({saleId:'sale-source',items:[
      {itemId:'milk',quantity:1,inputUnit:'Thùng',expectedFactor:1},
      {itemId:'tool',quantity:2,inputUnit:'Cái',expectedFactor:1},
    ]})));
  });
  it('fails closed for an unassigned branch URL',async()=>{
    mocks.params='branch=foreign&sale=sale-source';
    render(<Page/>);
    await screen.findByText('Không có quyền xem phiếu nhận tại chi nhánh này.');
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('requires a reason before an administrator confirms an unconfigured ingredient as stock',async()=>{
    render(<Page/>);
    await screen.findByText('Ghi chi phí vận hành');
    fireEvent.change(screen.getByLabelText('Thực nhận Vật tư vận hành'),{target:{value:'1'}});
    fireEvent.change(screen.getByLabelText('Cách ghi nhận Vật tư vận hành'),{target:{value:'stock'}});
    expect(screen.getByRole('button',{name:'Xác nhận thực nhận'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Lý do chọn nhập tồn (bắt buộc)'),{target:{value:'Nguyên liệu chưa khai báo công thức'}});
    fireEvent.click(screen.getByRole('button',{name:'Xác nhận thực nhận'}));
    await waitFor(()=>expect(mocks.receive).toHaveBeenCalledWith(expect.objectContaining({items:[{itemId:'tool',quantity:1,inputUnit:'Cái',expectedFactor:1,receivingTreatment:'stock'}]})));
  });
  it('does not offer treatment changes after receipt history exists',async()=>{
    mocks.read.mockResolvedValue([{...order,items:order.items.map(item=>item.id==='tool'?{...item,received:1}:item),receipts:[{id:'previous',createdAt:'2026-10-19T09:00:00Z',updatedAt:'2026-10-19T09:00:00Z',createdBy:'Admin',revision:1,items:[{itemId:'tool',quantity:1}]}]}]);
    render(<Page/>);
    await screen.findByText('Ghi chi phí vận hành');
    expect(screen.queryByLabelText('Cách ghi nhận Vật tư vận hành')).not.toBeInTheDocument();
  });
});
