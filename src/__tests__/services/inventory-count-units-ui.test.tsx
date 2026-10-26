import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), conversions: vi.fn(), toast: vi.fn(),
  auth: { currentBranch: { branchType: "store" }, branches: [], activeBranchId: "xtb" },
}));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => mocks.auth,
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/services/supabase/fnb-branch-cost", () => ({ getFnbBranchComponentCosts: async () => new Map([["milk", { unitCost: 30000 }]]) }));
vi.mock("@/lib/services/supabase/uom", () => ({ getUOMConversions: mocks.conversions }));
// The quantity workflow is independent of Base UI portal/exit animations.
// Shared select behavior is covered separately; use its native semantic contract.
vi.mock("@/components/ui/select",async()=>{
  const React=await import("react");
  const SelectTrigger=(_props:any)=>null;
  return {
    Select:(props:any)=>{
      const trigger:any=React.Children.toArray(props.children).find((child:any)=>child?.type===SelectTrigger);
      return React.createElement("select",{value:props.value,"aria-label":trigger?.props["aria-label"],onChange:(event:any)=>props.onValueChange(event.target.value)},props.children);
    },
    SelectTrigger,SelectValue:()=>null,
    SelectContent:({children}:any)=>children,
    SelectItem:({value,children}:any)=>React.createElement("option",{value},children),
  };
});
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentContext: async () => ({ tenantId: "tenant", userId: "user", branchId: "xtb" }),
  getClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        limit: async () => ({ data: [{ id: "milk", code: "SUA", name: "Sữa", unit: "Lon", cost_price: 28000 }], error: null }),
        is: async () => ({ data: table === "branch_stock" ? [{ quantity: 24.5 }] : [], error: null }),
      };
      return query;
    },
  }),
}));

import { CreateInventoryCheckDialog } from "@/components/shared/dialogs/create-inventory-check-dialog";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mocks.auth.currentBranch.branchType = "store";
  mocks.conversions.mockResolvedValue([
    { fromUnit: "Thùng", toUnit: "Lon", factor: 12, isActive: true },
    { fromUnit: "Lon", toUnit: "G", factor: 1000, isActive: true },
  ]);
  mocks.rpc.mockResolvedValue({ data: { check_id: "check", code: "KK1", status: "balanced" }, error: null });
});
afterEach(cleanup);

it("keeps warehouse packaging entry without the outlet unit picker", async () => {
  mocks.auth.currentBranch.branchType = "warehouse";
  render(<CreateInventoryCheckDialog open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("Tìm theo mã, tên hoặc barcode"), { target: { value: "SUA" } });
  fireEvent.click(await screen.findByRole("button", { name: /Sữa.*SUA.*Thêm/ }));
  await screen.findByLabelText("Số Thùng Sữa");
  expect(screen.queryByRole("combobox", { name: "Đơn vị kiểm Sữa" })).toBeNull();
  expect(screen.getByLabelText("Số Thùng Sữa")).toHaveValue("2");
  expect(screen.getByLabelText("Số lẻ Sữa")).toHaveValue("0.5");
  fireEvent.click(screen.getByRole("button", { name: "Hoàn thành kiểm kho" }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(mocks.rpc.mock.calls[0][1].p_items).toEqual([{ product_id: "milk", quantity: 24.5, inputUnit:"Lon", expectedFactor:1,parts:[{quantity:2,unit:"Thùng",expectedFactor:12},{quantity:.5,unit:"Lon",expectedFactor:1}] }]);
}, 15_000);

async function addMilk() {
  render(<CreateInventoryCheckDialog open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("Tìm theo mã, tên hoặc barcode"), { target: { value: "SUA" } });
  fireEvent.click(await screen.findByRole("button", { name: /Sữa.*SUA.*Thêm/ }));
  await screen.findByRole("combobox", { name: "Đơn vị kiểm Sữa" });
}

it("preserves the count on unit changes and posts grams in canonical units once", async () => {
  await addMilk();
  const input = await screen.findByLabelText("Tồn thực tế Sữa");
  expect(input).toHaveValue("24,500");
  fireEvent.change(input, { target: { value: "500" } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "Hoàn thành kiểm kho" }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(mocks.rpc).toHaveBeenCalledWith("create_stock_operation_with_uom", expect.objectContaining({
    p_kind:"inventory_check",p_request_id:expect.any(String),p_branch_id: "xtb", p_note: null,
    p_items: [{ product_id: "milk", quantity: 500, inputUnit:"G", expectedFactor:.001 }],
  }));
}, 15_000);

it("does not silently fall back to a stock unit when conversions fail to load", async () => {
  mocks.conversions.mockRejectedValue(new Error("network"));
  render(<CreateInventoryCheckDialog open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("Tìm theo mã, tên hoặc barcode"), { target: { value: "SUA" } });
  fireEvent.click(await screen.findByRole("button", { name: /Sữa.*SUA.*Thêm/ }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Không tải được đơn vị quy đổi hoặc giá vốn" })));
  expect(screen.queryByRole("combobox", { name: "Đơn vị kiểm Sữa" })).toBeNull();
  expect(mocks.rpc).not.toHaveBeenCalled();
}, 15_000);

it("keeps the original small weight when switching back and forth before posting", async () => {
  mocks.conversions.mockResolvedValue([{fromUnit:"Lon",toUnit:"G",factor:1100,isActive:true}]);
  await addMilk();
  const input=screen.getByLabelText("Tồn thực tế Sữa");
  fireEvent.change(input,{target:{value:"1"}});fireEvent.blur(input);
  function chooseUnit(unit:string) {
    fireEvent.change(screen.getByRole("combobox",{name:"Đơn vị kiểm Sữa"}),{target:{value:unit}});
  }
  for(let index=0;index<3;index++) {
    chooseUnit("Lon");chooseUnit("G");
  }
  expect(input).toHaveValue("1");
  fireEvent.click(screen.getByRole("button",{name:"Hoàn thành kiểm kho"}));
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(mocks.rpc.mock.calls[0][1].p_items).toEqual([{product_id:"milk",quantity:1,inputUnit:"G",expectedFactor:.000909090909}]);
},15_000);

it("restores counted quantities and the same save request after reload following a failed save", async () => {
  mocks.rpc.mockResolvedValue({data:null,error:{message:"network interrupted"}});
  await addMilk();
  const input=screen.getByLabelText("Tồn thực tế Sữa");
  fireEvent.change(input,{target:{value:"805"}});fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button",{name:"Hoàn thành kiểm kho"}));
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(1));
  const original=mocks.rpc.mock.calls[0][1];
  await waitFor(()=>{
    const key=Object.keys(localStorage).find(key=>key.includes("inventory-check-create"));
    expect(key).toBeTruthy();
    const draft=JSON.parse(localStorage.getItem(key!)!);
    expect(draft.data.checkItems[0].actualStock).toBe(805);
    expect(draft.data.request.id).toBe(original.p_request_id);
  });
  cleanup();
  render(<CreateInventoryCheckDialog open onOpenChange={()=>{}} />);
  expect(await screen.findByLabelText("Tồn thực tế Sữa")).toHaveValue("805");
  mocks.rpc.mockResolvedValue({data:{check_id:"check",code:"KK1",status:"balanced"},error:null});
  fireEvent.click(screen.getByRole("button",{name:"Hoàn thành kiểm kho"}));
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(2));
  expect(mocks.rpc.mock.calls[1][1]).toEqual(original);
  await waitFor(()=>expect(Object.keys(localStorage).filter(key=>key.includes("inventory-check-create"))).toHaveLength(0));
},15000);

it("creates a new save request after the count changes and uses branch cost in the preview", async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:"network interrupted"}});
  await addMilk();
  const input=screen.getByLabelText("Tồn thực tế Sữa");
  fireEvent.change(input,{target:{value:"25000"}});fireEvent.blur(input);
  // 25 cans minus 24.5 at branch cost 30,000 = 15,000, not global cost 28,000.
  expect(screen.getAllByText(/15,000/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button",{name:"Hoàn thành kiểm kho"}));
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(1));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Hoàn thành kiểm kho"})).not.toBeDisabled());
  fireEvent.change(input,{target:{value:"26000"}});fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button",{name:"Hoàn thành kiểm kho"}));
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(2));
  expect(mocks.rpc.mock.calls[1][1].p_request_id).not.toBe(mocks.rpc.mock.calls[0][1].p_request_id);
},15000);
