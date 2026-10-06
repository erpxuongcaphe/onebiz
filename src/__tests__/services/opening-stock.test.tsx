import { act,render,screen,fireEvent,cleanup } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import type { InitialStockImportRow } from "@/lib/excel/schemas";
const {rpc,props}=vi.hoisted(()=>({rpc:vi.fn(),props:{current:null as any}}));
vi.mock("@/lib/services/supabase/base",()=>({getClient:()=>({rpc})}));
vi.mock("@/components/shared/dialogs/import-excel-dialog",()=>({ImportExcelDialog:(p:any)=>{
  props.current=p;return <div>{p.uploadContent}{p.previewContent}<button disabled={p.confirmDisabled}>Xác nhận</button></div>;
}}));
import { OpeningStockDialog } from "@/components/shared/dialogs/opening-stock-dialog";
import { openingError,previewOpeningStock,commitOpeningStock,packOpeningRows } from "@/lib/services/supabase/opening-stock";
const rows:InitialStockImportRow[]=[{productCode:"TRA",branchCode:"QUAN",quantity:0.0042,costPrice:250}];
const preview=[{productId:"p",productCode:"TRA",productName:"Trà",unit:"G",branchId:"b",branchCode:"QUAN",quantityBefore:0,
 quantity:0.0042,costPrice:250,costBefore:null,delta:0.0042,value:1.05,latestMovement:null,latestCost:null,costTracked:false,fnb:true,lotNumber:null,expiryDate:null}];
beforeEach(()=>{rpc.mockReset();props.current=null;});afterEach(cleanup);
describe("safe opening stock",()=>{
 it("rejects a future source time before requesting a server preview",async()=>{
  render(<OpeningStockDialog open onOpenChange={()=>{}} onFinished={()=>{}}/>);
  fireEvent.change(screen.getByLabelText("Lý do / nguồn đối chiếu"),{target:{value:"Nguồn cũ"}});
  fireEvent.change(screen.getByLabelText("Ngày giờ chốt ở nguồn cũ"),{target:{value:"2099-01-01T12:00"}});
  await expect(props.current.preparePreview(rows,new File(["x"],"ton.xlsx"))).rejects.toThrow("tương lai");
  expect(rpc).not.toHaveBeenCalled();
  expect(openingError("OPENING_WORKFLOW_REQUIRED").message).toContain("Tải lại trang Tồn kho");
 });
 it("discards a delayed preview after closing the dialog",async()=>{
  render(<OpeningStockDialog open onOpenChange={()=>{}} onFinished={()=>{}}/>);
  fireEvent.change(screen.getByLabelText("Lý do / nguồn đối chiếu"),{target:{value:"Chuyển nguồn"}});
  let finish:(value:any)=>void=()=>{};
  rpc.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  let pending:Promise<unknown>;
  await act(async()=>{pending=props.current.preparePreview(rows,new File(["x"],"ton.xlsx"));});
  await act(async()=>{props.current.onOpenChange(false);});
  await act(async()=>{
   finish({data:preview,error:null});
   await expect(pending!).rejects.toThrow("đã đóng");
  });
  expect(props.current.confirmDisabled).toBe(true);
 });
 it("loads the server snapshot and keeps one request id when the response is retried",async()=>{
  rpc.mockResolvedValueOnce({data:preview,error:null});
  const value=await previewOpeningStock(rows);expect(value).toEqual(preview);
  expect(rpc).toHaveBeenCalledWith("preview_inventory_opening_00442",{p_rows:rows.map(row=>({...row,expiryDate:undefined}))});
  const input={id:"same-batch",rows,preview,purpose:"migration" as const,sourceAt:"2026-10-06T10:00:00Z",reason:"Nguồn",fileName:"ton.xlsx"};
  rpc.mockResolvedValue({data:{id:input.id,count:1,totalValue:1.05,replayed:true},error:null});
  await commitOpeningStock(input);await commitOpeningStock(input);
  expect(rpc.mock.calls[1][1]).toEqual(rpc.mock.calls[2][1]);
 });
 it("explains stale stock as an instruction to refresh, not a partial success",async()=>{
  rpc.mockResolvedValue({data:null,error:{message:"OPENING_PREVIEW_CHANGED"}});
  await expect(previewOpeningStock(rows)).rejects.toThrow("chưa ghi dữ liệu");
  expect(openingError("OPENING_USE_STOCKTAKE: TRA").message).toContain("Kiểm kho");
 });
 it("normalizes date-only shelf life without UTC shifting a Vietnamese day",()=>{
  const packed=packOpeningRows([{...rows[0],expiryDate:new Date("2026-12-31T00:00:00+07:00")}]);
  expect(packed[0].expiryDate).toBe("2026-12-31");
 });
 it("requires a source reason before preparing and displays inventory precision",async()=>{
  render(<OpeningStockDialog open onOpenChange={()=>{}} onFinished={()=>{}}/>);
  await expect(props.current.preparePreview(rows,new File(["x"],"ton.xlsx"))).rejects.toThrow("lý do");
  expect(rpc).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Lý do / nguồn đối chiếu"),{target:{value:"Chuyển nguồn"}});
  rpc.mockResolvedValue({data:preview,error:null});
  await act(async()=>{await props.current.preparePreview(rows,new File(["x"],"ton.xlsx"));});
  expect(screen.getAllByText("0.0042").length).toBeGreaterThan(0);
  expect(screen.getByText("Giá vốn riêng của quán; không đổi giá Retail.")).toBeTruthy();
  expect(screen.getByRole("button",{name:"Xác nhận"}).hasAttribute("disabled")).toBe(false);
 });
 it("requires a deliberate confirmation when in-stock items have zero cost",async()=>{
  render(<OpeningStockDialog open onOpenChange={()=>{}} onFinished={()=>{}}/>);
  fireEvent.change(screen.getByLabelText("Lý do / nguồn đối chiếu"),{target:{value:"Hàng tặng"}});
  rpc.mockResolvedValue({data:[{...preview[0],quantity:5,costPrice:0,value:0}],error:null});
  await act(async()=>{await props.current.preparePreview([{...rows[0],quantity:5,costPrice:0}],new File(["x"],"ton.xlsx"));});
  expect(screen.getByRole("button",{name:"Xác nhận"}).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox",{name:/Tôi xác nhận những dòng/}));
  expect(screen.getByRole("button",{name:"Xác nhận"}).hasAttribute("disabled")).toBe(false);
 });
});
