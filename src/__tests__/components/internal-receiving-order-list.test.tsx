import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
const mocks=vi.hoisted(()=>({export:vi.fn()}));
vi.mock('@/lib/utils/export',()=>({exportToExcel:mocks.export}));
import {InternalReceivingOrderList} from '@/components/shared/internal-receiving-order-list';
import type {InternalReceivingOrder} from '@/lib/services/supabase/internal-receiving';
import {receivingVietnamDay} from '@/lib/receiving-view-state';
const orders:InternalReceivingOrder[]=Array.from({length:40},(_,n)=>({id:String(n),code:`NB-${n}`,createdAt:new Date(Date.UTC(2026,9,1,n)).toISOString(),fromBranch:'Warehouse',toBranch:'Outlet',invoiceId:'invoice',status:'completed',receiptMode:'actual',receipts:[],items:[{id:`line-${n}`,productId:`sku-${n}`,code:`SKU-${n}`,name:`Item ${n}`,unit:'Hộp',dispatched:0.0042,received:n===39?0.0042:0,treatment:'stock'}]}));
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));mocks.export.mockResolvedValue(undefined);});
describe('receiving document management table',()=>{
  it('exports all sorted matches, not only the displayed page',async()=>{
    render(<InternalReceivingOrderList initialPreset="all" orders={orders} loading={false} busy={false} canExport onOpen={()=>{}} onClose={()=>{}} detail={null}/>);
    fireEvent.click(screen.getByRole('button',{name:'Danh sách'}));
    await waitFor(()=>expect(mocks.export).toHaveBeenCalled());
    const [rows]=mocks.export.mock.calls[0];
    expect(rows).toHaveLength(40);expect(rows[0].code).toBe('NB-39');expect(rows[39].code).toBe('NB-0');
  });
  it('filters received documents and exports exact line quantities and conversions',async()=>{
    render(<InternalReceivingOrderList initialPreset="all" orders={orders} loading={false} busy={false} canExport onOpen={()=>{}} onClose={()=>{}} detail={null}/>);
    fireEvent.change(screen.getByLabelText('Trạng thái nhận'),{target:{value:'received'}});
    fireEvent.click(screen.getByRole('button',{name:'Chi tiết hàng'}));
    await waitFor(()=>expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0]).toMatchObject([{sku:'SKU-39',sent:0.0042,received:0.0042,remaining:0}]);
    expect(mocks.export.mock.calls[0][1]).toContainEqual({header:'Theo đơn',key:'sent',precision:4});
  });
  it('blocks export when the date range is invalid',()=>{
    render(<InternalReceivingOrderList initialPreset="all" orders={orders} loading={false} busy={false} canExport onOpen={()=>{}} onClose={()=>{}} detail={null}/>);
    fireEvent.change(screen.getByLabelText('Thời gian nhận nội bộ'),{target:{value:'custom'}});
    fireEvent.change(screen.getByLabelText('Từ ngày'),{target:{value:'2026-10-20'}});
    fireEvent.change(screen.getByLabelText('Đến ngày'),{target:{value:'2026-10-01'}});
    expect(screen.getByRole('alert')).toHaveTextContent('Ngày bắt đầu');
    expect(screen.getByRole('button',{name:'Danh sách'})).toBeDisabled();
  });
  it('shows editable dates immediately after choosing custom without opening document filters',()=>{
    render(<InternalReceivingOrderList initialPreset="all" orders={orders} loading={false} busy={false} canExport onOpen={()=>{}} onClose={()=>{}} detail={null}/>);
    expect(screen.queryByLabelText('Từ ngày')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Thời gian nhận nội bộ'),{target:{value:'custom'}});
    expect(screen.getByLabelText('Từ ngày')).toBeVisible();
    expect(screen.getByLabelText('Đến ngày')).toBeVisible();
    expect(screen.getByText('Lọc theo: Ngày xuất')).toBeVisible();
    expect(screen.getByText('Bộ lọc chứng từ').closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByText('Tất cả thời gian',{selector:'span'})).not.toBeInTheDocument();
  });
  it('uses the visible custom range for both table and exports, including Vietnam day boundaries',async()=>{
    const rows=['2026-10-28T16:59:00Z','2026-10-28T17:00:00Z','2026-10-29T16:59:00Z','2026-10-29T17:00:00Z']
      .map((createdAt,n)=>({...orders[n],code:`BOUNDARY-${n}`,createdAt}));
    render(<InternalReceivingOrderList initialPreset="all" orders={rows} loading={false} busy={false} canExport onOpen={()=>{}} onClose={()=>{}} detail={null}/>);
    fireEvent.change(screen.getByLabelText('Thời gian nhận nội bộ'),{target:{value:'custom'}});
    fireEvent.change(screen.getByLabelText('Từ ngày'),{target:{value:'2026-10-29'}});
    fireEvent.change(screen.getByLabelText('Đến ngày'),{target:{value:'2026-10-29'}});
    expect(within(screen.getByRole('table')).getByText('BOUNDARY-1')).toBeVisible();
    expect(within(screen.getByRole('table')).getByText('BOUNDARY-2')).toBeVisible();
    expect(screen.queryByText('BOUNDARY-0')).not.toBeInTheDocument();
    expect(screen.queryByText('BOUNDARY-3')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Danh sách'}));
    await waitFor(()=>expect(mocks.export).toHaveBeenCalledTimes(1));
    expect(mocks.export.mock.calls[0][0].map((r:{code:string})=>r.code)).toEqual(['BOUNDARY-2','BOUNDARY-1']);
    fireEvent.click(screen.getByRole('button',{name:'Chi tiết hàng'}));
    await waitFor(()=>expect(mocks.export).toHaveBeenCalledTimes(2));
    expect(mocks.export.mock.calls[1][0].map((r:{code:string})=>r.code)).toEqual(['BOUNDARY-2','BOUNDARY-1']);
    fireEvent.change(screen.getByLabelText('Thời gian nhận nội bộ'),{target:{value:'all'}});
    expect(screen.queryByLabelText('Từ ngày')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('BOUNDARY-0')).toBeVisible();
    expect(within(screen.getByRole('table')).getByText('BOUNDARY-3')).toBeVisible();
  });
  it('offers a compact view without losing the full columns or any historical status',()=>{
    render(<InternalReceivingOrderList initialPreset="all" orders={orders} loading={false} busy={false} canExport onOpen={()=>{}} onClose={()=>{}} detail={null}/>);
    expect(screen.getByRole('button',{name:'Tất cả'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByText('Tiến độ nhận',{selector:'th *'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Đầy đủ'}));
    expect(screen.getByRole('button',{name:'Đầy đủ'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getAllByText('Người xuất').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button',{name:'Đã nhận đủ'}));
    expect(screen.getAllByText('NB-39').length).toBeGreaterThan(0);
    expect(screen.queryByText('NB-38')).not.toBeInTheDocument();
  });
  it('starts with today in Vietnam, keeps older history available, and resets to today',()=>{
    const today=receivingVietnamDay();
    const rows=[{...orders[0],code:'TODAY',createdAt:`${today}T03:00:00Z`},{...orders[1],code:'OLDER',createdAt:'2000-01-01T03:00:00Z'}];
    render(<InternalReceivingOrderList orders={rows} loading={false} busy={false} canExport onOpen={()=>{}} onClose={()=>{}} detail={null}/>);
    expect(screen.getByLabelText('Thời gian nhận nội bộ')).toHaveValue('today');
    expect(screen.getAllByText('TODAY').length).toBeGreaterThan(0);
    expect(screen.queryByText('OLDER')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Thời gian nhận nội bộ'),{target:{value:'all'}});
    expect(screen.getAllByText('OLDER').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button',{name:'Đặt lại'}));
    expect(screen.queryByText('OLDER')).not.toBeInTheDocument();
  });
});
