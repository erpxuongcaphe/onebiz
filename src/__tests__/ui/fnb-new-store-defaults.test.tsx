import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks=vi.hoisted(()=>({get:vi.fn(),save:vi.fn()}));
vi.mock("@/lib/services/supabase/fnb-new-store-defaults",()=>({getFnbNewStoreDefault:mocks.get,saveFnbNewStoreDefault:mocks.save}));
import { FnbNewStoreDefaults } from "@/components/shared/fnb-new-store-defaults";
const branches=[{id:"store",name:"Quán mẫu",branchType:"store"},{id:"wh",name:"Kho tổng",branchType:"warehouse"}];
beforeEach(()=>{vi.clearAllMocks();mocks.get.mockResolvedValue({enabled:false,templateBranchId:null});mocks.save.mockResolvedValue({enabled:true,templateBranchId:"store"});});
afterEach(cleanup);
async function open(){render(<FnbNewStoreDefaults branches={branches}/>);await waitFor(()=>expect(screen.getByRole("checkbox")).not.toBeDisabled());fireEvent.click(screen.getByText(/Mặc định quán mới/));}
it("loads without writing and only saves an explicitly chosen store template",async()=>{
 await open();expect(mocks.save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("checkbox"));
 expect(screen.queryByRole("option",{name:"Kho tổng"})).toBeNull();
 const save=screen.getByRole("button",{name:"Lưu mặc định quán mới"});expect(save).toBeDisabled();
 fireEvent.change(screen.getByRole("combobox"),{target:{value:"store"}});fireEvent.click(save);
 await screen.findByRole("status");expect(mocks.save).toHaveBeenCalledExactlyOnceWith({enabled:true,templateBranchId:"store"});
 expect(screen.getByRole("button",{name:"Lưu mặc định quán mới"})).toBeDisabled();
});
it("fails closed on unreadable defaults and supports explicit reload",async()=>{
 mocks.get.mockRejectedValueOnce(new Error("Mất mạng"));
 render(<FnbNewStoreDefaults branches={branches}/>);await screen.findByRole("alert");
 expect(screen.getByRole("checkbox")).toBeDisabled();expect(mocks.save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Tải lại trạng thái"}));
 await waitFor(()=>expect(screen.getByRole("checkbox")).not.toBeDisabled());expect(mocks.get).toHaveBeenCalledTimes(2);
});
it("retains the selected template on save error and blocks double-clicks",async()=>{
 await open();fireEvent.click(screen.getByRole("checkbox"));fireEvent.change(screen.getByRole("combobox"),{target:{value:"store"}});
 let reject!:(reason:Error)=>void;mocks.save.mockReturnValue(new Promise((_,r)=>{reject=r;}));
 fireEvent.click(screen.getByRole("button",{name:"Lưu mặc định quán mới"}));
 expect(screen.getByRole("combobox")).toBeDisabled();expect(mocks.save).toHaveBeenCalledTimes(1);
 reject(new Error("Quán mẫu chưa bật sổ riêng"));await screen.findByRole("alert");
 expect(screen.getByRole("combobox")).toHaveValue("store");expect(screen.getByRole("checkbox")).toBeChecked();
});
