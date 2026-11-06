import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";

const api=vi.hoisted(()=>({create:vi.fn(),update:vi.fn(),toast:vi.fn()}));
vi.mock("@/lib/services",()=>({createSupplier:api.create,updateSupplier:api.update,getCategoriesByScope:async()=>[{id:"group-bbi",code:"BBI",name:"Bao bì"}]}));
vi.mock("@/lib/contexts",()=>({useToast:()=>({toast:api.toast})}));

import {CreateSupplierDialog} from "@/components/shared/dialogs/create-supplier-dialog";

const identity={id:"supplier-test",code:"NCC-BBI-004",name:"Synthetic supplier"};
const initial={...identity,phone:"0000000000",createdAt:"2026-01-01"};
beforeEach(()=>{vi.clearAllMocks();api.create.mockResolvedValue(identity);api.update.mockResolvedValue(identity);});
afterEach(cleanup);

describe("supplier save identity acknowledgement",()=>{
  it("keeps the header and actions outside the form scroll region",()=>{
    render(<CreateSupplierDialog open onOpenChange={vi.fn()}/>);
    const dialog=screen.getByRole("dialog");
    const body=dialog.querySelector('[data-slot="dialog-body"]');
    const footer=dialog.querySelector('[data-slot="dialog-footer"]');
    expect(dialog).toHaveClass("flex","flex-col","overflow-hidden","max-h-[90dvh]");
    expect(body).toHaveClass("min-h-0","overflow-y-auto");
    expect(body).toContainElement(screen.getByPlaceholderText("Nhập tên nhà cung cấp"));
    expect(body).toContainElement(screen.getByPlaceholderText("Ghi chú thêm"));
    expect(body).not.toContainElement(footer as HTMLElement);
    expect(footer).toContainElement(screen.getByRole("button",{name:"Lưu"}));
    expect(footer).toHaveClass("shrink-0");
  });

  it("closes and refreshes after create without financial fields",async()=>{
    const onSuccess=vi.fn(),onOpenChange=vi.fn();
    render(<CreateSupplierDialog open onOpenChange={onOpenChange} onSuccess={onSuccess}/>);
    const group = await screen.findByRole("combobox", {name:/Nhóm nhà cung cấp/});
    await waitFor(()=>expect(group).toBeEnabled());
    fireEvent.keyDown(group,{key:"ArrowDown"});
    fireEvent.click(await screen.findByRole("option",{name:/Bao bì/}));
    expect(screen.getByLabelText("Mã NCC")).toHaveValue("NCC-BBI-…");
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Nhập tên nhà cung cấp"),{target:{value:identity.name}});
    fireEvent.click(screen.getByRole("button",{name:"Lưu"}));
    await waitFor(()=>expect(onSuccess).toHaveBeenCalledWith());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({name:identity.name}),"group-bbi");
    expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({variant:"success",description:expect.stringContaining(identity.code)}));
  });

  it("keeps the update callback contract with an identity-only response",async()=>{
    const onSuccess=vi.fn(),onOpenChange=vi.fn();
    render(<CreateSupplierDialog open initialData={initial} onOpenChange={onOpenChange} onSuccess={onSuccess}/>);
    fireEvent.change(screen.getByPlaceholderText("Nhập tên nhà cung cấp"),{target:{value:"Updated supplier"}});
    fireEvent.click(screen.getByRole("button",{name:"Cập nhật"}));
    await waitFor(()=>expect(onSuccess).toHaveBeenCalledWith());
    expect(api.update).toHaveBeenCalledWith(identity.id,expect.objectContaining({name:"Updated supplier"}));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.create).not.toHaveBeenCalled();
  });

  it("does not close or refresh when saving is rejected",async()=>{
    api.update.mockRejectedValue(new Error("Save denied"));
    const onSuccess=vi.fn(),onOpenChange=vi.fn();
    render(<CreateSupplierDialog open initialData={initial} onOpenChange={onOpenChange} onSuccess={onSuccess}/>);
    fireEvent.click(screen.getByRole("button",{name:"Cập nhật"}));
    await waitFor(()=>expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({variant:"error"})));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("validates an empty name before calling the writer",async()=>{
    render(<CreateSupplierDialog open onOpenChange={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button",{name:"Lưu"}));
    expect(await screen.findByText("Tên nhà cung cấp là bắt buộc")).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });
});
