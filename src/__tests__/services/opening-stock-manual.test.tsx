import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({search:vi.fn(),preview:vi.fn(),commit:vi.fn(),prices:vi.fn()}));
vi.mock("@/lib/hooks/use-product-uom",()=>({useProductUom:()=>({map:new Map([["p",[{fromUnit:"Kg",toUnit:"G",factor:1000,isActive:true}]]]),units:new Map([["p","G"]]),loading:false,error:""})}));
vi.mock("@/lib/contexts",()=>({useAuth:()=>({branches:[{id:"b",code:"QUAN",name:"Quán",branchType:"store"}],activeBranchId:"b"})}));
vi.mock("@/lib/services/supabase/opening-stock",async()=>({...await vi.importActual("@/lib/services/supabase/opening-stock"),
 searchOpeningStockCandidates:mocks.search,previewOpeningStock:mocks.preview,commitOpeningStock:mocks.commit,getOpeningWarehousePrices:mocks.prices}));
import {OpeningStockDialog} from "@/components/shared/dialogs/opening-stock-dialog";
const snapshot={productId:"p",productCode:"TRA",productName:"Trà",unit:"G",branchId:"b",branchCode:"QUAN",quantityBefore:0,quantity:2.0042,costPrice:250.000001,costBefore:null,delta:2.0042,value:501.05,latestMovement:null,latestCost:null,costTracked:false,fnb:true,lotNumber:null,expiryDate:null};
beforeEach(()=>{vi.clearAllMocks();mocks.search.mockResolvedValue([{id:"p",code:"TRA",name:"Trà",unit:"G"}]);mocks.preview.mockResolvedValue([snapshot]);mocks.commit.mockResolvedValue({count:1});});
afterEach(cleanup);

it("keeps entry units separate and previews canonical quantity and cost together",async()=>{
 render(<OpeningStockDialog open mode="manual" onOpenChange={()=>{}} onFinished={()=>{}}/>);await add();
 fireEvent.change(screen.getByLabelText("Đơn vị TRA"),{target:{value:"Kg"}});
 fireEvent.change(screen.getByLabelText("Số lượng (Kg)"),{target:{value:"2"}});
 fireEvent.change(screen.getByLabelText("Giá vốn / Kg"),{target:{value:"45000"}});
 fireEvent.change(screen.getByLabelText("Lý do / nguồn đối chiếu"),{target:{value:"Tồn đầu kỳ theo bao"}});
 fireEvent.click(screen.getByRole("button",{name:"Xem trước tồn"}));
 await waitFor(()=>expect(mocks.preview).toHaveBeenCalledWith([expect.objectContaining({unit:"G",quantity:2000,costPrice:45})]));
 expect(mocks.commit).not.toHaveBeenCalled();
});

it("fills only empty costs using inventory-unit quotes and keeps deliberate zero values",async()=>{
 render(<OpeningStockDialog open mode="manual" onOpenChange={()=>{}} onFinished={()=>{}}/>);await add();
 fireEvent.change(screen.getByLabelText("Số lượng (G)"),{target:{value:"10"}});
 mocks.prices.mockResolvedValue([{productId:"p",unit:"G",costPrice:20.545455}]);
 fireEvent.click(screen.getByRole("button",{name:"Lấy giá kho tổng cho dòng trống"}));
 await screen.findByText(/Đã điền giá 1\/1/);
 expect(mocks.prices).toHaveBeenCalledExactlyOnceWith("b",["p"]);
 await waitFor(()=>expect(screen.getByLabelText("Giá vốn / G")).toHaveValue("20.545455"));
 expect(mocks.preview).not.toHaveBeenCalled();expect(mocks.commit).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText("Giá vốn / G"),{target:{value:"0"}});
 expect(screen.getByRole("button",{name:"Lấy giá kho tổng cho dòng trống"})).toBeDisabled();
});
it.each([null,0,-1,NaN])("keeps missing or invalid quote %s blank instead of silently valuing it at zero",async costPrice=>{
 render(<OpeningStockDialog open mode="manual" onOpenChange={()=>{}} onFinished={()=>{}}/>);await add();
 mocks.prices.mockResolvedValue([{productId:"p",unit:"G",costPrice}]);
 fireEvent.click(screen.getByRole("button",{name:"Lấy giá kho tổng cho dòng trống"}));
 await screen.findByText(/Đã điền giá 0\/1/);
 expect(screen.getByLabelText("Giá vốn / G")).toHaveValue("");expect(mocks.commit).not.toHaveBeenCalled();
});
it("rejects mismatched quote units and preserves input when price lookup fails",async()=>{
 render(<OpeningStockDialog open mode="manual" onOpenChange={()=>{}} onFinished={()=>{}}/>);await add();
 mocks.prices.mockResolvedValue([{productId:"p",unit:"Kg",costPrice:1000}]);
 fireEvent.click(screen.getByRole("button",{name:"Lấy giá kho tổng cho dòng trống"}));await screen.findByText(/Đã điền giá 0\/1/);
 expect(screen.getByLabelText("Giá vốn / G")).toHaveValue("");
 fireEvent.change(screen.getByLabelText("Số lượng (G)"),{target:{value:"3"}});
 mocks.prices.mockRejectedValue(new Error("Chưa bật sổ giá vốn riêng cho quán."));
 fireEvent.click(screen.getByRole("button",{name:"Lấy giá kho tổng cho dòng trống"}));await screen.findByRole("alert");
 expect(screen.getByLabelText("Số lượng (G)")).toHaveValue("3");expect(mocks.commit).not.toHaveBeenCalled();
});
it("does not preview or duplicate requests while loading prices",async()=>{
 render(<OpeningStockDialog open mode="manual" onOpenChange={()=>{}} onFinished={()=>{}}/>);await add();
 let resolve!:(value:unknown)=>void;mocks.prices.mockReturnValue(new Promise(r=>{resolve=r;}));
 fireEvent.click(screen.getByRole("button",{name:"Lấy giá kho tổng cho dòng trống"}));
 expect(screen.getByLabelText("Số lượng (G)")).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Xem trước tồn"}));expect(mocks.preview).not.toHaveBeenCalled();
 resolve([{productId:"p",unit:"G",costPrice:25}]);await screen.findByText(/Đã điền giá 1\/1/);
 expect(mocks.prices).toHaveBeenCalledTimes(1);
});
async function add(){fireEvent.change(screen.getByLabelText("Thêm hàng"),{target:{value:"TRA"}});fireEvent.click(await screen.findByRole("option",{name:/TRA.*Trà/}));}
it("keeps blank costs distinct from zero, preserves edits on back, and commits only after server preview",async()=>{
 render(<OpeningStockDialog open mode="manual" onOpenChange={()=>{}} onFinished={()=>{}}/>);
 await add();
 fireEvent.click(screen.getByRole("button",{name:"Xem trước tồn"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("nhập đủ");expect(mocks.preview).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText("Lý do / nguồn đối chiếu"),{target:{value:"Kiểm đếm thực tế"}});
 fireEvent.change(screen.getByLabelText("Số lượng (G)"),{target:{value:"2.0042"}});
 fireEvent.change(screen.getByLabelText("Giá vốn / G"),{target:{value:"250.000001"}});
 fireEvent.click(screen.getByRole("button",{name:"Xem trước tồn"}));
 await screen.findByRole("button",{name:"Xác nhận nhập 1 dòng"});
 expect(mocks.preview).toHaveBeenCalledWith([expect.objectContaining({productCode:"TRA",branchCode:"QUAN",unit:"G",quantity:2.0042,costPrice:250.000001})]);
 expect(mocks.commit).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Sửa dữ liệu"}));
 expect(screen.getByLabelText("Số lượng (G)")).toHaveValue("2.0042");
 fireEvent.click(screen.getByRole("button",{name:"Xem trước tồn"}));
 fireEvent.click(await screen.findByRole("button",{name:"Xác nhận nhập 1 dòng"}));
 await waitFor(()=>expect(mocks.commit).toHaveBeenCalledTimes(1));
 expect(mocks.commit.mock.calls[0][0]).toMatchObject({fileName:"Nhập trực tiếp trên web",reason:"Kiểm đếm thực tế",preview:[snapshot]});
});
it("shows a server rejection without committing or discarding entered quantities",async()=>{
 render(<OpeningStockDialog open mode="manual" onOpenChange={()=>{}} onFinished={()=>{}}/>);await add();
 fireEvent.change(screen.getByLabelText("Lý do / nguồn đối chiếu"),{target:{value:"Đối chiếu"}});
 fireEvent.change(screen.getByLabelText("Số lượng (G)"),{target:{value:"3"}});fireEvent.change(screen.getByLabelText("Giá vốn / G"),{target:{value:"0"}});
 mocks.preview.mockRejectedValue(new Error("Đã có phát sinh. Dùng Kiểm kho."));
 fireEvent.click(screen.getByRole("button",{name:"Xem trước tồn"}));
 await screen.findByText("Đã có phát sinh. Dùng Kiểm kho.");expect(mocks.commit).not.toHaveBeenCalled();expect(screen.getByLabelText("Số lượng (G)")).toHaveValue("3");
});
it("supports keyboard selection and shows optional lot fields with visible labels",async()=>{
 render(<OpeningStockDialog open mode="manual" onOpenChange={()=>{}} onFinished={()=>{}}/>);
 const search=screen.getByLabelText("Thêm hàng");fireEvent.change(search,{target:{value:"TRA"}});
 await screen.findByRole("option",{name:/TRA.*Trà/});fireEvent.keyDown(search,{key:"Enter"});
 expect(screen.getByLabelText("Số lượng (G)")).toBeTruthy();
 fireEvent.click(screen.getByText("Lô, hạn sử dụng, ghi chú (tùy chọn)"));
 expect(screen.getByLabelText("Số lô")).toBeTruthy();expect(screen.getByLabelText("Hạn sử dụng")).toBeTruthy();expect(screen.getByLabelText("Ghi chú hàng")).toBeTruthy();
 expect(screen.getByRole("button",{name:"Xem trước tồn"}).getAttribute("form")).toBe("opening-manual-form");
 expect(mocks.preview).not.toHaveBeenCalled();
});
it("filters unfinished rows but restores the full draft when review finds missing data",async()=>{
 render(<OpeningStockDialog open mode="manual" onOpenChange={()=>{}} onFinished={()=>{}}/>);await add();
 fireEvent.change(screen.getByLabelText("Số lượng (G)"),{target:{value:"2"}});fireEvent.change(screen.getByLabelText("Giá vốn / G"),{target:{value:"250"}});
 mocks.search.mockResolvedValue([{id:"p2",code:"SUA",name:"Sữa",unit:"G"}]);
 fireEvent.change(screen.getByLabelText("Thêm hàng"),{target:{value:"SUA"}});fireEvent.click(await screen.findByRole("option",{name:/SUA.*Sữa/}));
 fireEvent.click(screen.getByRole("button",{name:"Chưa đủ thông tin (1)"}));
 expect(screen.queryByText("Trà")).toBeNull();expect(screen.getByText("Sữa")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Xem trước tồn"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("SUA: nhập đủ");expect(screen.getByText("Trà")).toBeTruthy();
 expect(screen.getByText("Còn thiếu số lượng và giá vốn.")).toBeTruthy();expect(mocks.preview).not.toHaveBeenCalled();expect(mocks.commit).not.toHaveBeenCalled();
});


it("offers direct entry from the Excel screen without a file and keeps manual drafts safe", async () => {
 render(<OpeningStockDialog open mode="file" onOpenChange={()=>{}} onFinished={()=>{}}/>);
 expect(screen.getByRole("button",{name:"Từ Excel"})).toHaveAttribute("aria-pressed","true");
 fireEvent.click(screen.getByRole("button",{name:"Nhập trực tiếp"}));
 expect(screen.getByRole("button",{name:"Nhập trực tiếp"})).toHaveAttribute("aria-pressed","true");
 expect(screen.queryByRole("button",{name:"Chọn file"})).not.toBeInTheDocument();
 await add();
 fireEvent.change(screen.getByLabelText("Số lượng (G)"),{target:{value:"2"}});
 expect(screen.getByRole("button",{name:"Từ Excel"})).toBeDisabled();
 expect(screen.getByLabelText("Số lượng (G)")).toHaveValue("2");
 expect(mocks.preview).not.toHaveBeenCalled();
 expect(mocks.commit).not.toHaveBeenCalled();
});

it("previews and commits multiple manually entered ingredients together only after confirmation", async () => {
 render(<OpeningStockDialog open mode="manual" onOpenChange={()=>{}} onFinished={()=>{}}/>);
 await add();
 fireEvent.change(screen.getByLabelText("Lý do / nguồn đối chiếu"),{target:{value:"Khởi tạo nhiều nguyên liệu"}});
 fireEvent.change(screen.getByLabelText("Số lượng (G)"),{target:{value:"2.0042"}});
 fireEvent.change(screen.getByLabelText("Giá vốn / G"),{target:{value:"250.000001"}});
 mocks.search.mockResolvedValue([{id:"p2",code:"SUA",name:"Sữa",unit:"Hộp"}]);
 fireEvent.change(screen.getByLabelText("Thêm hàng"),{target:{value:"SUA"}});
 fireEvent.click(await screen.findByRole("option",{name:/SUA.*Sữa/}));
 fireEvent.change(screen.getByLabelText("Số lượng (Hộp)"),{target:{value:"3"}});
 fireEvent.change(screen.getByLabelText("Giá vốn / Hộp"),{target:{value:"32000"}});
 mocks.preview.mockResolvedValue([snapshot,{...snapshot,productId:"p2",productCode:"SUA",productName:"Sữa",unit:"Hộp",quantity:3,costPrice:32000,delta:3,value:96000}]);
 fireEvent.click(screen.getByRole("button",{name:"Xem trước tồn"}));
 await screen.findByRole("button",{name:"Xác nhận nhập 2 dòng"});
 expect(mocks.preview).toHaveBeenCalledWith([
   expect.objectContaining({productCode:"TRA",quantity:2.0042,costPrice:250.000001}),
   expect.objectContaining({productCode:"SUA",quantity:3,costPrice:32000})
 ]);
 expect(mocks.commit).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Xác nhận nhập 2 dòng"}));
 await waitFor(()=>expect(mocks.commit).toHaveBeenCalledTimes(1));
 expect(mocks.commit.mock.calls[0][0].rows).toHaveLength(2);
});
