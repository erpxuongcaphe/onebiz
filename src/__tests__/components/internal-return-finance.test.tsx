import {beforeEach,it,expect,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
const mocks=vi.hoisted(()=>({get:vi.fn(),settle:vi.fn()}));
vi.mock('@/lib/services/supabase/internal-returns',()=>({getInternalReturnFinance:mocks.get,settleInternalReturn:mocks.settle}));
import {InternalReturnFinancePanel} from '@/components/shared/internal-return-finance';
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();mocks.get.mockResolvedValue({credits:[{id:'credit',createdAt:'2026-11-11',original:24000,remaining:24000}],invoices:[{id:'invoice',code:'HD001',debt:20000}],accounts:[],history:[]});});
it('loads finance only on demand and requires preview; uncertain retries retain the same request',async()=>{
 render(<InternalReturnFinancePanel returnId="return" userId="actor" canRefund={false}/>);
 expect(mocks.get).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Xử lý công nợ'}));
 fireEvent.change(await screen.findByLabelText('Khoản chờ xử lý'),{target:{value:'credit'}});
 expect(screen.queryByRole('option',{name:'Ghi nhận đã hoàn tiền'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Chứng từ hoặc quỹ'),{target:{value:'invoice'}});
 fireEvent.change(screen.getByLabelText('Số tiền xử lý'),{target:{value:'10000'}});fireEvent.blur(screen.getByLabelText('Số tiền xử lý'));
 fireEvent.change(screen.getByLabelText('Lý do xử lý công nợ'),{target:{value:'Cấn công nợ'}});
 fireEvent.click(screen.getByRole('button',{name:'Xem trước công nợ'}));expect(mocks.settle).not.toHaveBeenCalled();
 mocks.settle.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValueOnce({id:'settlement',remaining:14000});
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận xử lý công nợ'}));fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra lại kết quả'}));
 await waitFor(()=>expect(mocks.settle).toHaveBeenCalledTimes(2));expect(mocks.settle.mock.calls[0]).toEqual(mocks.settle.mock.calls[1]);
});
it('restores an unresolved settlement on remount',async()=>{
 const p={event:'credit',kind:'refund',amount:100,target:'account',note:'Đã hoàn',requestId:'same'};
 sessionStorage.setItem('onebiz:return-settlement:actor:return',JSON.stringify(p));mocks.settle.mockResolvedValue({id:'s',remaining:0});
 render(<InternalReturnFinancePanel returnId="return" userId="actor" canRefund/>);
 fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra lại kết quả'}));
 await waitFor(()=>expect(mocks.settle).toHaveBeenCalledWith(p));
});
