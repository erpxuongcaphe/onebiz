import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {InternalReceivingOrder} from '@/lib/services/supabase/internal-receiving';
import type {ReactNode} from 'react';

const mocks=vi.hoisted(()=>({read:vi.fn(),receive:vi.fn(),params:'branch=xtb&sale=sale-source'}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(mocks.params)}));
vi.mock('@/lib/contexts',()=>({useAuth:()=>({user:{id:'user',tenantId:'tenant'}}),useBranchFilter:()=>({activeBranchId:'warehouse',currentBranch:{id:'warehouse',name:'Kho Tổng'},isReady:true,branches:[{id:'warehouse',name:'Kho Tổng'},{id:'xtb',name:'Tư Búa'}]})}));
vi.mock('@/lib/permissions/use-permission',()=>({usePermissions:()=>({hasPermission:()=>true})}));
vi.mock('@/lib/hooks/use-product-uom',()=>({useProductUom:()=>({map:new Map(),error:null})}));
vi.mock('@/lib/services/supabase/internal-receiving',()=>({getInternalReceivingWorkspace:mocks.read,receiveInternalSale:mocks.receive}));
vi.mock('@/components/shared/data-table',()=>({DataTable:({data,expandedRow,renderDetail}:{data:InternalReceivingOrder[];expandedRow:number|null;renderDetail:(row:InternalReceivingOrder,onClose:()=>void)=>ReactNode})=><div>{data.map(row=><div key={row.id}>{row.code}</div>)}{expandedRow!=null&&expandedRow>=0&&renderDetail(data[expandedRow],()=>{})}</div>}));
import Page from '@/app/(main)/hang-hoa/nhap-hang/noi-bo/page';

const order:InternalReceivingOrder={id:'sale-source',code:'BNB-FIXTURE',createdAt:'2026-10-19T08:00:00Z',fromBranch:'Kho Tổng',invoiceId:'invoice',policyVersion:1,receipts:[],items:[
  {id:'milk',productId:'milk-case',code:'SKU-MILK-CASE',name:'Sữa thùng',unit:'Thùng',dispatched:2,received:0,treatment:'stock',receivingProductId:'milk-box',receivingProductCode:'SKU-MILK-BOX',receivingFactor:12,receivingUnit:'Hộp'},
  {id:'tool',productId:'tool',code:'SKU-TOOL',name:'Vật tư vận hành',unit:'Cái',dispatched:3,received:0,treatment:'expense'},
]};
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));mocks.params='branch=xtb&sale=sale-source';mocks.read.mockResolvedValue([order]);mocks.receive.mockResolvedValue({receiptId:'new-receipt'});});

describe('internal receiving treatment',()=>{
  it('opens the permitted source branch locally without changing the POS branch',async()=>{
    render(<Page/>);
    await screen.findByText('Chi phí vận hành',{selector:'span'});
    expect(mocks.read).toHaveBeenCalledWith('xtb');
    expect(mocks.read).not.toHaveBeenCalledWith('warehouse');
    expect(screen.getByText('SKU-MILK-BOX · 1 Thùng = 12 Hộp')).toBeInTheDocument();
    expect(screen.getAllByText('Nhập tồn',{selector:'span'}).length).toBeGreaterThan(0);
  });
  it('submits physical source quantities, leaving cost and unit conversion authority on the server',async()=>{
    render(<Page/>);
    fireEvent.click(await screen.findByRole('button',{name:'Nhận hàng'}));
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
    fireEvent.click(await screen.findByRole('button',{name:'Nhận hàng'}));
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
    fireEvent.click(await screen.findByRole('button',{name:'Nhận tiếp'}));
    expect(screen.queryByLabelText('Cách ghi nhận Vật tư vận hành')).not.toBeInTheDocument();
  });
  it('keeps completed and cancelled documents visible by default and blocks receiving cancelled orders',async()=>{
    mocks.params='branch=xtb&sale=cancelled';
    mocks.read.mockResolvedValue([{...order,id:'finished',code:'NB-FINISHED',status:'completed',items:order.items.map(i=>({...i,received:i.dispatched}))},{...order,id:'cancelled',code:'NB-CANCELLED',status:'cancelled'}]);
    render(<Page/>);
    await screen.findByText('NB-FINISHED');
    expect(screen.getAllByText('NB-CANCELLED').length).toBeGreaterThan(0);
    expect(screen.getByText('Đơn đã hủy. Lịch sử nhận được giữ để đối chiếu.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Thực nhận Sữa thùng')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Nhận hàng'})).not.toBeInTheDocument();
  });
  it('loads all and only assigned receiving branches when all branches are selected',async()=>{
    mocks.params='branch=all';mocks.read.mockResolvedValue([]);
    render(<Page/>);
    await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(2));
    expect(mocks.read).toHaveBeenCalledWith('warehouse');expect(mocks.read).toHaveBeenCalledWith('xtb');
  });
  it('allows closing a document opened from a source link without reopening it',async()=>{
    render(<Page/>);
    fireEvent.click(await screen.findByRole('button',{name:'Đóng chi tiết'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Đóng chi tiết'})).not.toBeInTheDocument());
  });
  it('opens in read mode and shows canonical received quantities without an editable form',async()=>{
    mocks.read.mockResolvedValue([{...order,items:order.items.map(item=>({...item,received:item.dispatched}))}]);
    render(<Page/>);
    await screen.findByText('Đã nhập: 24 Hộp · SKU-MILK-BOX');
    expect(screen.queryByLabelText('Thực nhận Sữa thùng')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Xác nhận thực nhận'})).not.toBeInTheDocument();
  });
  it('fills remaining amounts without submitting and previews the actual destination unit',async()=>{
    render(<Page/>);
    fireEvent.click(await screen.findByRole('button',{name:'Nhận hàng'}));
    fireEvent.click(screen.getByRole('button',{name:'Điền số còn lại'}));
    expect(screen.getByText('Sẽ nhập: 24 Hộp · SKU-MILK-BOX')).toBeInTheDocument();
    expect(mocks.receive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Hủy'}));
    expect(screen.queryByLabelText('Thực nhận Sữa thùng')).not.toBeInTheDocument();
  });
  it('shows receipt metadata and requires a reason when editing through history',async()=>{
    mocks.read.mockResolvedValue([{...order,items:order.items.map(item=>({...item,received:item.dispatched})),receipts:[{id:'receipt-first',createdAt:'2026-10-19T09:00:00Z',updatedAt:'2026-10-19T09:00:00Z',createdBy:'Admin',revision:1,note:'Giao đủ',items:[{itemId:'milk',quantity:2},{itemId:'tool',quantity:3}]}]}]);
    render(<Page/>);
    fireEvent.click(await screen.findByRole('tab',{name:'Lịch sử nhận (1)'}));
    expect(screen.getByText(/Mã lần nhận: receipt-first/)).toBeInTheDocument();
    expect(screen.getByText('Giao đủ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Sửa lần nhận'}));
    expect(screen.getByRole('button',{name:'Lưu số thực nhận đã sửa'})).toBeDisabled();
    expect(screen.getByLabelText('Lý do sửa (bắt buộc)')).toBeInTheDocument();
  });
});
