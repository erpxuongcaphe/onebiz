import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
const mocks=vi.hoisted(()=>({export:vi.fn()}));
vi.mock('@/lib/utils/export',()=>({exportToExcel:mocks.export}));
import {InternalReceivingOrderList} from '@/components/shared/internal-receiving-order-list';
import type {InternalReceivingOrder} from '@/lib/services/supabase/internal-receiving';
const orders:InternalReceivingOrder[]=Array.from({length:40},(_,n)=>({id:String(n),code:`NB-${n}`,createdAt:new Date(Date.UTC(2026,9,1,n)).toISOString(),fromBranch:'Warehouse',toBranch:'Outlet',invoiceId:'invoice',status:'completed',receiptMode:'actual',receipts:[],items:[{id:`line-${n}`,productId:`sku-${n}`,code:`SKU-${n}`,name:`Item ${n}`,unit:'Hộp',dispatched:0.0042,received:n===39?0.0042:0,treatment:'stock'}]}));
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));mocks.export.mockResolvedValue(undefined);});
describe('receiving document management table',()=>{
  it('exports all sorted matches, not only the displayed page',async()=>{
    render(<InternalReceivingOrderList orders={orders} loading={false} busy={false} canExport onOpen={()=>{}} onClose={()=>{}} detail={null}/>);
    fireEvent.click(screen.getByRole('button',{name:'Danh sách'}));
    await waitFor(()=>expect(mocks.export).toHaveBeenCalled());
    const [rows]=mocks.export.mock.calls[0];
    expect(rows).toHaveLength(40);expect(rows[0].code).toBe('NB-39');expect(rows[39].code).toBe('NB-0');
  });
  it('filters received documents and exports exact line quantities and conversions',async()=>{
    render(<InternalReceivingOrderList orders={orders} loading={false} busy={false} canExport onOpen={()=>{}} onClose={()=>{}} detail={null}/>);
    fireEvent.change(screen.getByLabelText('Trạng thái nhận'),{target:{value:'received'}});
    fireEvent.click(screen.getByRole('button',{name:'Chi tiết hàng'}));
    await waitFor(()=>expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0]).toMatchObject([{sku:'SKU-39',sent:0.0042,received:0.0042,remaining:0}]);
    expect(mocks.export.mock.calls[0][1]).toContainEqual({header:'Theo đơn',key:'sent',precision:4});
  });
  it('blocks export when the date range is invalid',()=>{
    render(<InternalReceivingOrderList orders={orders} loading={false} busy={false} canExport onOpen={()=>{}} onClose={()=>{}} detail={null}/>);
    fireEvent.change(screen.getByLabelText('Từ ngày'),{target:{value:'2026-10-20'}});
    fireEvent.change(screen.getByLabelText('Đến ngày'),{target:{value:'2026-10-01'}});
    expect(screen.getByRole('alert')).toHaveTextContent('Ngày bắt đầu');
    expect(screen.getByRole('button',{name:'Danh sách'})).toBeDisabled();
  });
  it('offers a compact view without losing the full columns or any historical status',()=>{
    render(<InternalReceivingOrderList orders={orders} loading={false} busy={false} canExport onOpen={()=>{}} onClose={()=>{}} detail={null}/>);
    expect(screen.getByRole('button',{name:'Tất cả'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByText('Tiến độ nhận',{selector:'th *'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Đầy đủ'}));
    expect(screen.getByRole('button',{name:'Đầy đủ'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getAllByText('Người xuất').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button',{name:'Đã nhận đủ'}));
    expect(screen.getAllByText('NB-39').length).toBeGreaterThan(0);
    expect(screen.queryByText('NB-38')).not.toBeInTheDocument();
  });
});
