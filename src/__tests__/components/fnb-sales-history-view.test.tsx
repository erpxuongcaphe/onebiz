import {act,fireEvent,render,screen,within} from "@testing-library/react";
import {beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({history:vi.fn(),cash:vi.fn(),items:vi.fn(),permission:true}));
vi.mock("@/lib/contexts",()=>({useAuth:()=>({hasPermission:(code:string)=>code==="finance.view_cash_book" || mock.permission})}));
vi.mock("@/lib/hooks/use-live-data-refresh",()=>({useLiveDataRefresh:()=>false}));
vi.mock("@/lib/services/supabase/fnb-sales-history",()=>({todayFnb:()=>"2026-10-20",getFnbDayHistory:mock.history,getFnbDayCash:mock.cash,getFnbHistoryItems:mock.items}));
import {FnbSalesHistoryView} from "@/app/pos/fnb/components/fnb-sales-history-view";
const row=(i:number)=>({id:String(i),invoiceId:String(i),code:`HD${i}`,customerName:"Khách",cashierName:"Huyên",total:100,paid:100,tipAmount:0,paymentMethod:"cash",status:"completed",createdAt:"2026-10-20T01:00:00Z",recordedAt:"2026-10-20T01:00:00Z",orderType:"takeaway",discount:0});
const props=()=>({branchId:"xtb",tenantId:"tenant",revision:0,onReprint:vi.fn(),onVoid:vi.fn(),reprinting:null,voiding:false,canVoidPaidBill:false});
beforeEach(()=>{vi.clearAllMocks();mock.permission=true;mock.history.mockResolvedValue({rows:Array.from({length:25},(_,i)=>row(i)),completed:25,pending:0,cancelled:0,invoiceValue:2500});mock.cash.mockResolvedValue({net:2000,received:2200,refunded:200,methods:{cash:2000},completed:25,pending:0,cancelled:0,invoiceValue:2500});mock.items.mockResolvedValue([{id:"line",name:"Cà phê",quantity:1,unitPrice:100,total:100,note:"Ít đường"}]);});
describe("cashier sales history",()=>{
 it("keeps daily counts while paging/searching and opens details only when requested",async()=>{
  render(<FnbSalesHistoryView {...props()}/>);await screen.findByText("25 kết quả · 1/2");
  expect(mock.items).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Trang sau"}));expect(screen.getByText("25 kết quả · 2/2")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Tìm đơn bán hàng"),{target:{value:"HD24"}});expect(screen.getByText("1 kết quả · 1/1")).toBeInTheDocument();expect(screen.getByRole("button",{name:/Đã thanh toán 25/})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:/HD24/}));await screen.findByText("Cà phê");expect(mock.items).toHaveBeenCalledTimes(1);expect(screen.getByText("Ghi chú: Ít đường")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Quay lại danh sách"));expect(screen.queryByRole("region",{name:"Chi tiết đơn bán hàng"})).not.toBeInTheDocument();expect(mock.history).toHaveBeenCalledTimes(1);
 });
 it("does not treat lack of cash permission as zero or block order history",async()=>{
  mock.permission=false;render(<FnbSalesHistoryView {...props()}/>);await screen.findByText("Trang 1");expect(mock.cash).not.toHaveBeenCalled();expect(screen.queryByText("Giá trị bill hoàn thành")).not.toBeInTheDocument();expect(screen.queryByText("Thực thu F&B trong ngày")).not.toBeInTheDocument();expect(screen.getByRole("button",{name:"Đã thanh toán"})).toBeInTheDocument();fireEvent.click(screen.getAllByRole("button",{name:/HD1Mang/})[0]);await screen.findByText("Cà phê");
 });
 it("hides cached totals immediately when summary permission is removed",async()=>{
  const p=props();const view=render(<FnbSalesHistoryView {...p}/>);await screen.findByText("Thu 2,200 · Hoàn 200");
  mock.permission=false;view.rerender(<FnbSalesHistoryView {...p}/>);
  expect(screen.queryByText("Thực thu F&B trong ngày")).not.toBeInTheDocument();
  expect(screen.queryByText("Thu 2,200 · Hoàn 200")).not.toBeInTheDocument();
  await screen.findByText("Trang 1");
 });
 it("clears previously loaded totals if the database revokes access before the client refreshes permissions",async()=>{
  render(<FnbSalesHistoryView {...props()}/>);await screen.findByText("Thu 2,200 · Hoàn 200");
  mock.cash.mockRejectedValueOnce(new Error("FNB_SALES_SUMMARY_PERMISSION_DENIED"));
  fireEvent.click(screen.getByLabelText("Tải lại lịch sử"));await screen.findByText("Chưa tải được tiền thu. Thử tải lại.");
  expect(screen.queryByText("Thu 2,200 · Hoàn 200")).not.toBeInTheDocument();
 });
 it("keeps history usable when cash fails and gives a visible retry on history failure",async()=>{
  mock.cash.mockRejectedValue(new Error("cash denied"));mock.history.mockRejectedValueOnce(new Error("Mạng lỗi"));render(<FnbSalesHistoryView {...props()}/>);
  await screen.findByRole("alert");fireEvent.click(screen.getByText("Thử lại"));await screen.findByText("25 kết quả · 1/2");expect(screen.getByText("Chưa tải được tiền thu. Thử tải lại.")).toBeInTheDocument();
 });
 it("keeps cash totals and loaded detail stable while refreshing unchanged rows",async()=>{
  const initial={rows:[row(1)],completed:1,pending:0,cancelled:0,invoiceValue:100};mock.history.mockResolvedValue(initial);
  render(<FnbSalesHistoryView {...props()}/>);await screen.findByText("1 kết quả · 1/1");fireEvent.click(screen.getByRole("button",{name:/HD1/}));await screen.findByText("Cà phê");
  let resolveCash!:(value:unknown)=>void;mock.cash.mockReturnValueOnce(new Promise(resolve=>{resolveCash=resolve;}));
  fireEvent.click(screen.getByLabelText("Tải lại lịch sử"));
  expect(screen.getByText("Thu 2,200 · Hoàn 200")).toBeInTheDocument();expect(screen.getByText("Cà phê")).toBeInTheDocument();
  await act(async()=>{resolveCash({net:2000,received:2200,refunded:200,methods:{cash:2000},completed:25,pending:0,cancelled:0,invoiceValue:2500});});
  expect(mock.items).toHaveBeenCalledTimes(1);
 });
 it("filters paid history by table/area while preserving explicit whole-day cash totals",async()=>{
  mock.history.mockResolvedValue({rows:[{...row(1),tableName:"TN 03",areaName:"Trong nhà",posNote:"Khách lấy thêm ly"},{...row(2),tableName:"NS 01",areaName:"Ngoài sân"}]});
  render(<FnbSalesHistoryView {...props()}/>);await screen.findByText("2 kết quả · 1/1");
  fireEvent.change(screen.getByLabelText("Lọc khu vực"),{target:{value:"Trong nhà"}});
  expect(screen.getByText("1 kết quả · 1/1")).toBeInTheDocument();expect(screen.queryByRole("button",{name:/HD2/})).toBeNull();
  expect(screen.getByText(/Khách lấy thêm ly/)).toBeInTheDocument();expect(screen.getByText("Thực thu F&B cả ngày")).toBeInTheDocument();
 });
 it("does not expose destructive actions as row buttons; cancelled bills have no print/void actions",async()=>{
  mock.history.mockResolvedValue({rows:[{...row(1),status:"cancelled"}],completed:0,pending:0,cancelled:1,invoiceValue:0});render(<FnbSalesHistoryView {...props()}/>);await screen.findByText("1 kết quả · 1/1");fireEvent.click(screen.getByRole("button",{name:/HD1/}));await screen.findByText("Cà phê");
  const detail=screen.getByRole("region",{name:"Chi tiết đơn bán hàng"});expect(within(detail).queryByLabelText("In lại hóa đơn")).toBeNull();expect(within(detail).queryByText("Xin duyệt hủy")).toBeNull();
 });
});
