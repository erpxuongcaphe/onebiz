import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import {describe,it,expect,vi,beforeEach} from "vitest";
const m=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/lib/services/supabase/fnb-invoice-choice-catalog",()=>({getFnbInvoiceChoiceCatalog:m.read}));
import {FnbInvoiceChoiceFilter} from "@/components/shared/fnb-invoice-choice-filter";
import {choiceKey} from "@/lib/utils/fnb-invoice-choice-filter";
const key=choiceKey("Đá/Nóng"),catalog={sizes:["Size L","Size M"],groups:[{key,name:"Đá/Nóng",values:["Đá","Nóng"]}]};
beforeEach(()=>{m.read.mockReset().mockResolvedValue(catalog);});
describe("FNB choice filter interaction",()=>{
 it("edits a draft and applies size and choices together, cancelling leaves the active filter intact",async()=>{
 const change=vi.fn();render(<FnbInvoiceChoiceFilter value={{}} onChange={change} ready branchId="a"/>);
 fireEvent.click(screen.getByRole("button",{name:"Size & tùy chọn"}));
 await waitFor(()=>expect(screen.getByRole("combobox",{name:"Lọc Size"})).not.toBeDisabled());
 fireEvent.change(screen.getByRole("combobox",{name:"Lọc Size"}),{target:{value:"Size L"}});
 fireEvent.change(screen.getByRole("combobox",{name:"Lọc Đá/Nóng"}),{target:{value:"Nóng"}});
 expect(change).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Áp dụng"}));
 expect(change).toHaveBeenCalledWith({size:"Size L",groups:{[key]:"Nóng"}});
 });
 it("does not apply a partial filter when loading fails and retries in the same dialog",async()=>{
 m.read.mockRejectedValueOnce(new Error("denied"));const change=vi.fn();render(<FnbInvoiceChoiceFilter value={{size:"Size L"}} onChange={change} ready branchId="a"/>);
 fireEvent.click(screen.getByRole("button",{name:/Size & tùy chọn/}));await screen.findByRole("alert");expect(screen.getByRole("button",{name:"Áp dụng"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Thử tải lại"}));await screen.findByRole("combobox",{name:"Lọc Size"});
 fireEvent.click(screen.getByRole("button",{name:"Hủy"}));expect(change).not.toHaveBeenCalled();
 });
});
