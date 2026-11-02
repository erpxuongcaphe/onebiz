import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
const mocks=vi.hoisted(()=>({get:vi.fn(),list:vi.fn(),save:vi.fn(),remove:vi.fn(),export:vi.fn(),permission:vi.fn(),context:{activeBranchId:'branch' as string|null,branchLabel:'Test branch',isReady:true}}));
vi.mock('@/lib/contexts',()=>({useBranchFilter:()=>mocks.context}));
vi.mock('@/lib/permissions/use-permission',()=>({usePermissions:()=>({hasPermission:mocks.permission})}));
vi.mock('@/lib/services/supabase/money-accounts',()=>({getMoneyAccounts:mocks.list,getMoneyAccountWorkspace:mocks.get,saveMoneyAccount:mocks.save,deleteMoneyAccount:mocks.remove}));
vi.mock('@/lib/utils/export',()=>({exportToExcel:mocks.export}));
import Page from '@/app/(main)/cai-dat/tai-khoan-tien/page';
import fs from 'node:fs';
const account={id:'a',branch_id:'branch',code:'NH-MB-002',name:'Account label',kind:'bank',bank_name:'MB Bank',account_number:'123456',account_holder:'Account holder',revision:3,active:true,opening_date:null,opening_amount:null};
beforeEach(()=>{vi.resetAllMocks();mocks.context={activeBranchId:'branch',branchLabel:'Test branch',isReady:true};mocks.permission.mockReturnValue(true);mocks.list.mockResolvedValue([account]);mocks.get.mockResolvedValue({accounts:[account],unassigned_count:0});mocks.save.mockResolvedValue(account);mocks.remove.mockResolvedValue('a');});
afterEach(cleanup);
async function open(){render(<Page/>);const table=await screen.findByRole('table');fireEvent.click(within(table).getByRole('button',{name:'Sửa'}));return within(screen.getByRole('dialog'));}
it('exports the actual rendered editor for optional visual verification',async()=>{await open();if(process.env.MONEY_ACCOUNT_QA_HTML){document.querySelectorAll('input').forEach(input=>input.setAttribute('value',input.value));fs.writeFileSync(process.env.MONEY_ACCOUNT_QA_HTML,document.body.innerHTML);}expect(screen.getByRole('dialog')).toHaveTextContent('Số dư ban đầu (không bắt buộc)');});
it('shows bank and holder in their own table columns',async()=>{render(<Page/>);const row=within(await screen.findByRole('table')).getByText(account.code).closest('tr')!;expect(within(row).getByText('MB Bank').closest('td')).not.toBe(within(row).getByText('Account label').closest('td'));expect(within(row).getByText('Account holder').closest('td')).not.toBe(within(row).getByText('Account label').closest('td'));});
it('edits a typo without creating another account and leaves opening balance unset',async()=>{const dialog=await open();expect(dialog.getByLabelText('Mã')).toBeEnabled();fireEvent.change(dialog.getByLabelText('Mã'),{target:{value:'NH-MB-02'}});fireEvent.change(dialog.getByLabelText('Lý do khai báo / điều chỉnh'),{target:{value:'Sửa mã nhập nhầm'}});fireEvent.click(dialog.getByRole('button',{name:'Lưu'}));await vi.waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(account,expect.objectContaining({code:'NH-MB-02',openingDate:null,openingAmount:null}),'Sửa mã nhập nhầm'));expect(mocks.remove).not.toHaveBeenCalled();});
it('requires confirmation and a reason before deleting and surfaces a used-account guard',async()=>{mocks.remove.mockRejectedValue(new Error('Tài khoản đã có chứng từ'));const dialog=await open();fireEvent.click(dialog.getByRole('button',{name:'Xóa tài khoản tạo nhầm'}));expect(mocks.remove).not.toHaveBeenCalled();fireEvent.click(dialog.getByRole('button',{name:'Xác nhận xóa'}));expect(mocks.remove).not.toHaveBeenCalled();fireEvent.change(dialog.getByLabelText('Lý do khai báo / điều chỉnh'),{target:{value:'Tạo nhầm'}});fireEvent.click(dialog.getByRole('button',{name:'Xác nhận xóa'}));await vi.waitFor(()=>expect(mocks.remove).toHaveBeenCalledWith(account,'Tạo nhầm'));expect(await dialog.findByText('Tài khoản đã có chứng từ')).toBeInTheDocument();});

it('opens account setup without date controls or balance RPCs and filters locally across bank details',async()=>{
 mocks.list.mockResolvedValue([account,{...account,id:'cash',code:'TM-TONG-01',name:'Quỹ tiền mặt tổng',kind:'cash',bank_name:null,account_number:null,account_holder:null}]);
 render(<Page/>);await screen.findByRole('table');
 expect(mocks.list).toHaveBeenCalledWith('branch');expect(mocks.get).not.toHaveBeenCalled();expect(screen.queryByLabelText('Từ ngày')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Tìm tài khoản'),{target:{value:'account holder'}});
 expect(within(screen.getByRole('table')).queryByText('TM-TONG-01')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Tìm tài khoản'),{target:{value:'quy tien mat'}});
 expect(within(screen.getByRole('table')).getByText('TM-TONG-01')).toBeInTheDocument();
 expect(mocks.list).toHaveBeenCalledTimes(1);expect(mocks.get).not.toHaveBeenCalled();
});

it('shows empty search separately from an empty register and resets filters',async()=>{
 render(<Page/>);await screen.findByRole('table');fireEvent.change(screen.getByLabelText('Tìm tài khoản'),{target:{value:'not found'}});
 expect(screen.getByText('Không có tài khoản phù hợp')).toBeInTheDocument();expect(screen.queryByText('Chưa có quỹ hoặc tài khoản tiền')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Bỏ điều kiện lọc'}));expect(screen.getByRole('table')).toBeInTheDocument();
});

it('only fetches a new balance period when applied and preserves unknown balances and unassigned warnings',async()=>{
 mocks.get.mockResolvedValue({accounts:[{...account,opening_balance:null,closing_balance:null,receipts:100,payments:0}],unassigned_count:2});
 render(<Page/>);await screen.findByRole('table');fireEvent.click(screen.getByRole('tab',{name:'Số dư & thu chi'}));
 const table=await screen.findByRole('table',{name:'Số dư và thu chi theo tài khoản'});
 expect(within(table).getAllByText('Chưa xác định')).toHaveLength(2);expect(screen.getByText(/2 phiếu trong kỳ/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Từ ngày'),{target:{value:'2026-01-01'}});expect(mocks.get).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Xem số dư'}));await vi.waitFor(()=>expect(mocks.get).toHaveBeenCalledTimes(2));
 expect(mocks.get).toHaveBeenLastCalledWith('branch','2026-01-01',expect.any(String));
 fireEvent.change(screen.getByLabelText('Đến ngày'),{target:{value:'2025-12-31'}});expect(screen.getByRole('button',{name:'Xem số dư'})).toBeDisabled();expect(mocks.get).toHaveBeenCalledTimes(2);
});

it('exports exactly the filtered metadata without reporting undefined balances as zero',async()=>{
 mocks.list.mockResolvedValue([account,{...account,id:'other',code:'NH-ACB-01',name:'ACB account',bank_name:'Asia Bank'}]);
 render(<Page/>);await screen.findByRole('table');fireEvent.change(screen.getByLabelText('Tìm tài khoản'),{target:{value:'MB Bank'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Xuất Excel'}));});expect(mocks.export).toHaveBeenCalledTimes(1);
 const [rows,columns]=mocks.export.mock.calls[0];expect(rows).toHaveLength(1);expect(rows[0].id).toBe('a');expect(columns.some((c:{key:string})=>c.key==='closing_balance')).toBe(false);
});

it('reports load failures and offers retry without pretending there are no accounts',async()=>{
 mocks.list.mockRejectedValueOnce(new Error('Tải thất bại'));
 render(<Page/>);expect(await screen.findByRole('alert')).toHaveTextContent('Tải thất bại');expect(screen.queryByText('Chưa có quỹ hoặc tài khoản tiền')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Thử tải lại'}));await screen.findByRole('table');expect(mocks.list).toHaveBeenCalledTimes(2);
});

it('supports viewing without exposing account edit or create actions',async()=>{
 mocks.permission.mockImplementation((permission:string)=>permission==='finance.view_cash_book');render(<Page/>);await screen.findByRole('table');
 expect(screen.queryByRole('button',{name:'Sửa'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Thêm tài khoản'})).not.toBeInTheDocument();
});

it('hides cached records, editor and export when view permission is removed',async()=>{
 const view=render(<Page/>);const table=await screen.findByRole('table');fireEvent.click(within(table).getByRole('button',{name:'Sửa'}));expect(screen.getByRole('dialog')).toBeInTheDocument();
 mocks.permission.mockImplementation((permission:string)=>permission!=='finance.view_cash_book');view.rerender(<Page/>);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.queryByText(account.name)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Xuất Excel'})).toBeDisabled();
});

it('drops the previous branch data, pending requests and editor when branch changes',async()=>{
 const view=render(<Page/>);const table=await screen.findByRole('table');fireEvent.click(within(table).getByRole('button',{name:'Sửa'}));expect(screen.getByRole('dialog')).toBeInTheDocument();
 mocks.context={activeBranchId:'branch-b',branchLabel:'Second branch',isReady:true};mocks.list.mockResolvedValue([{...account,id:'b',branch_id:'branch-b',code:'SECOND',name:'Second account'}]);
 view.rerender(<Page/>);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();const next=await screen.findByRole('table');expect(within(next).queryByText(account.code)).not.toBeInTheDocument();expect(within(next).getByText('SECOND')).toBeInTheDocument();expect(mocks.list).toHaveBeenLastCalledWith('branch-b');
});

it('combines kind, status and setup filters and treats an explicit zero opening as configured',async()=>{
 mocks.list.mockResolvedValue([{...account,opening_date:'2026-01-01',opening_amount:0},{...account,id:'cash',code:'CASH',name:'Cash fund',kind:'cash',active:false}]);
 render(<Page/>);await screen.findByRole('table');
 fireEvent.change(screen.getByLabelText('Loại nguồn tiền'),{target:{value:'cash'}});expect(within(screen.getByRole('table')).getByText('CASH')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Trạng thái'),{target:{value:'active'}});expect(screen.getByText('Không có tài khoản phù hợp')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Bỏ điều kiện lọc'}));fireEvent.click(screen.getByRole('checkbox',{name:'Chưa khai báo số dư ban đầu'}));
 expect(within(screen.getByRole('table')).queryByText(account.code)).not.toBeInTheDocument();expect(within(screen.getByRole('table')).getByText('CASH')).toBeInTheDocument();expect(mocks.list).toHaveBeenCalledTimes(1);
});

it('ignores a late account-list response after switching to balances',async()=>{
 let finish!: (value:unknown)=>void;mocks.list.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 render(<Page/>);await vi.waitFor(()=>expect(mocks.list).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('tab',{name:'Số dư & thu chi'}));
 await screen.findByRole('table',{name:'Số dư và thu chi theo tài khoản'});
 await act(async()=>{finish([{...account,code:'STALE'}]);});
 expect(within(screen.getByRole('table')).queryByText('STALE')).not.toBeInTheDocument();expect(within(screen.getByRole('table')).getByText(account.code)).toBeInTheDocument();
});

it('renders representative account and balance workspaces for optional visual QA',async()=>{
 mocks.context.branchLabel='Đồng Xoài · dữ liệu mẫu';
 const samples=[
  {...account,code:'NH-MB-01',name:'MB nhận tiền bán hàng',bank_name:'Ngân hàng Quân đội (MB)',account_number:'001234567890',account_holder:'Nguyễn Văn An',opening_date:'2026-01-01',opening_amount:10000000,opening_balance:10000000,receipts:18500000,payments:7200000,closing_balance:21300000},
  {...account,id:'vcb',code:'NH-VCB-01',name:'Vietcombank chi vận hành',bank_name:'Vietcombank',account_number:'0123456789012',account_holder:'Công ty TNHH Cà phê mẫu',opening_date:'2026-01-01',opening_amount:0,opening_balance:0,receipts:12000000,payments:4500000,closing_balance:7500000},
  {...account,id:'cash',code:'TM-TONG-01',name:'Tiền mặt tổng',kind:'cash',bank_name:null,account_number:null,account_holder:null,opening_balance:null,closing_balance:null,receipts:2500000,payments:0},
  {...account,id:'old',code:'NH-TCB-01',name:'Techcombank trước đây',bank_name:'Techcombank',account_number:'01234567890',account_holder:'Nguyễn Văn An',active:false,opening_date:'2026-01-01',opening_amount:0,opening_balance:0,closing_balance:0,receipts:0,payments:0},
 ];
 mocks.list.mockResolvedValue(samples);mocks.get.mockResolvedValue({accounts:samples,unassigned_count:2});
 const capture=(name:string)=>{if(process.env.MONEY_WORKSPACE_QA_DIR){document.querySelectorAll('input').forEach(el=>{el.setAttribute('value',el.value);if(el.checked)el.setAttribute('checked','');else el.removeAttribute('checked');});document.querySelectorAll('select').forEach(el=>Array.from(el.options).forEach(option=>{if(option.value===el.value)option.setAttribute('selected','');else option.removeAttribute('selected');}));fs.writeFileSync(process.env.MONEY_WORKSPACE_QA_DIR+'/'+name+'.html',document.body.innerHTML);}};
 render(<Page/>);await screen.findByRole('table');expect(screen.getByRole('tab',{name:'Danh sách tài khoản'})).toHaveAttribute('aria-selected','true');capture('accounts');
 fireEvent.click(screen.getByRole('tab',{name:'Số dư & thu chi'}));await screen.findByRole('table',{name:'Số dư và thu chi theo tài khoản'});capture('balances');
 fireEvent.change(screen.getByLabelText('Tìm tài khoản'),{target:{value:'không khớp dữ liệu'}});expect(screen.getByText('Không có tài khoản phù hợp')).toBeInTheDocument();capture('empty-search');
});
