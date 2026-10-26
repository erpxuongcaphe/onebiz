import React from 'react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
const f=vi.hoisted(()=>({forecast:vi.fn(),customers:vi.fn(),groups:vi.fn(),excel:vi.fn(),toast:vi.fn()}));
vi.mock('@/lib/services',()=>({getPurchaseForecast:f.forecast,getCustomerGroupsAsync:f.groups}));
vi.mock('@/lib/services/supabase/order-management-reads',()=>({getForecastCustomerOptions:f.customers}));
vi.mock('@/lib/contexts',()=>({useBranchFilter:()=>({activeBranchId:'warehouse',branchLabel:'Kho tổng',isReady:true}),useToast:()=>({toast:f.toast})}));
vi.mock('@/lib/hooks/use-report-state',()=>({useReportState:()=>({preset:'thisMonth',range:{from:'2026-10-01',to:'2026-10-26'},viewMode:'table',setPreset:vi.fn(),setCustomRange:vi.fn(),setViewMode:vi.fn()})}));
vi.mock('@/lib/utils/excel-export',()=>({exportReportToExcel:f.excel,buildReportTitleRows:()=>['Dự kiến mua hàng','Kho tổng']}));
vi.mock('@/components/shared/report',()=>({ReportPageHeader:({onExportFull,exportDisabled}:{onExportFull:()=>void;exportDisabled:boolean})=><button disabled={exportDisabled} onClick={onExportFull}>Xuất báo cáo</button>}));
vi.mock('@/app/(main)/phan-tich/_components',()=>({ChartCard:({children,title}:{children:React.ReactNode;title:string})=><section><h2>{title}</h2>{children}</section>}));
import Page from '@/app/(main)/mua-hang/du-kien-mua-hang/page';
const report=(code:string)=>({khoTongName:'Kho tổng',orderCount:1,totalToBuyAmount:3000,materials:[{materialId:code,code,name:code,unit:'Kg',required:2,stockKhoTong:1,toBuy:1,unitCost:3000,amount:3000}],skuRows:[]});
async function pickCustomer(){
  await waitFor(()=>expect((screen.getByRole('button',{name:'Khách hàng cụ thể'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Khách hàng cụ thể'}));
  fireEvent.click(await screen.findByRole('option',{name:/NB: Tư Búa/}));
}
beforeEach(()=>{cleanup();vi.clearAllMocks();f.forecast.mockResolvedValue(report('SUA'));f.customers.mockResolvedValue([{id:'nb',code:'NB1',name:'NB: Tư Búa',phone:'0901'},{id:'ws',code:'WS1',name:'Khách Sỉ',phone:null}]);f.groups.mockResolvedValue([{value:'g',label:'Nhóm sỉ'}]);f.excel.mockResolvedValue(undefined);});
describe('forecast filters and workbook scope',()=>{
 it('exports only matching materials or SKU rows according to the visible item filters',async()=>{
  f.forecast.mockResolvedValue({...report('SUA'),materials:[report('SUA').materials[0],report('CA-PHE').materials[0]],skuRows:[{productId:'s',code:'SKU-SUA',name:'Sữa',unit:'Kg',branchName:'Kho tổng',orderedQuantity:2,issuedQuantity:1,remainingQuantity:1,amount:3000}]});
  render(<Page/>);await waitFor(()=>expect((screen.getByRole('button',{name:'Xuất báo cáo'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Mã hoặc tên NVL / SKU'),{target:{value:'SUA'}});
  fireEvent.change(screen.getByLabelText('Loại cần xem'),{target:{value:'materials'}});
  fireEvent.click(screen.getByRole('button',{name:'Xuất báo cáo'}));await waitFor(()=>expect(f.excel).toHaveBeenCalledOnce());
  expect(f.excel.mock.calls[0][0].sheets).toHaveLength(1);expect(f.excel.mock.calls[0][0].sheets[0].rows.map((r:{code:string})=>r.code)).toEqual(['SUA']);
  expect(f.excel.mock.calls[0][0].sheets[0].footer.amount).toBe(3000);
 });
 it('loads internal customers and searches without accents by code/name/phone',async()=>{
  render(<Page/>);await waitFor(()=>expect((screen.getByRole('button',{name:'Khách hàng cụ thể'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Khách hàng cụ thể'}));
  fireEvent.change(await screen.findByRole('combobox',{name:'Tìm mã, tên, SĐT khách…'}),{target:{value:'tu bua'}});
  expect(screen.queryByRole('option',{name:/Khách Sỉ/})).toBeNull();
  expect(screen.getByRole('option',{name:/NB: Tư Búa/})).toBeTruthy();
  fireEvent.click(screen.getByRole('option',{name:/NB: Tư Búa/}));
  await waitFor(()=>expect(f.forecast).toHaveBeenLastCalledWith(expect.objectContaining({customerId:'nb'}),'warehouse'));
 });
 it('exports the customer-filtered result with the filter printed in the workbook',async()=>{
  render(<Page/>);await waitFor(()=>expect((screen.getByRole('button',{name:'Khách hàng cụ thể'}) as HTMLButtonElement).disabled).toBe(false));
  await pickCustomer();
  await waitFor(()=>expect((screen.getByRole('button',{name:'Xuất báo cáo'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Xuất báo cáo'}));await waitFor(()=>expect(f.excel).toHaveBeenCalledOnce());
  expect(f.excel.mock.calls[0][0].sheets[0].titleRows.join(' ')).toContain('NB1 · NB: Tư Búa');
  expect(f.excel.mock.calls[0][0].sheets[0].rows).toHaveLength(1);
 });
 it('ignores an older response after the customer filter changes',async()=>{
  let oldResolve:(v:unknown)=>void=()=>{};f.forecast.mockImplementationOnce(()=>new Promise(resolve=>{oldResolve=resolve;})).mockResolvedValue(report('NEW'));
  render(<Page/>);await waitFor(()=>expect((screen.getByRole('button',{name:'Khách hàng cụ thể'}) as HTMLButtonElement).disabled).toBe(false));
  await pickCustomer();
  await waitFor(()=>expect(f.forecast).toHaveBeenCalledTimes(2));oldResolve(report('OLD'));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Xuất báo cáo'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Xuất báo cáo'}));await waitFor(()=>expect(f.excel).toHaveBeenCalledOnce());
  expect(f.excel.mock.calls[0][0].sheets[0].rows[0].code).toBe('NEW');
 });
 it('keeps customer options when groups fail and displays a retry instead of silent empty filters',async()=>{
  f.groups.mockRejectedValue(new Error('groups failed'));render(<Page/>);
  await pickCustomer();expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Tải lại danh sách'})).toBeTruthy();
 });
 it('reports export failures and rejects a delayed download after filters change',async()=>{
  f.excel.mockRejectedValueOnce(new Error('Download failed'));render(<Page/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Xuất báo cáo'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Xuất báo cáo'}));await waitFor(()=>expect(f.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Không xuất được file'})));
  const guard=f.excel.mock.calls[0][0].shouldSave;expect(guard()).toBe(true);
  await pickCustomer();expect(guard()).toBe(false);
 });
});
