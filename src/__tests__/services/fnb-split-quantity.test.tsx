import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitBillDialog } from "@/app/pos/fnb/components/split-bill-dialog";

const items = [{id:"coffee",name:"Cà phê tươi pha máy",quantity:2,unitPrice:22000,detail:"Ít đá"}];
describe("partial split quantities", () => {
 it("splits one cup from a single two-cup line and reuses its request ID after a failed response", async () => {
   const submit=vi.fn().mockResolvedValue(false);
   render(<SplitBillDialog open items={items} onOpenChange={vi.fn()} onSplitByItems={submit} onSplitEqually={vi.fn()} />);
   fireEvent.click(screen.getByRole("checkbox"));
   expect(screen.getByLabelText("Số lượng tách Cà phê tươi pha máy")).toHaveValue(1);
   expect(screen.getByText(/Còn lại: 1/)).toBeInTheDocument();
   expect(screen.getByText("Giá trị món chọn: 22,000đ · trước giảm giá")).toBeInTheDocument();
   fireEvent.click(screen.getByRole("button",{name:"Tách 1 món"}));
   await screen.findByRole("alert");
   expect(submit).toHaveBeenCalledWith([{itemId:"coffee",quantity:1,expectedQuantity:2}],expect.any(String));
   fireEvent.click(screen.getByRole("button",{name:"Tách 1 món"}));
   await waitFor(()=>expect(submit).toHaveBeenCalledTimes(2));
   expect(submit.mock.calls[0][1]).toBe(submit.mock.calls[1][1]);
 });
 it("blocks the whole quantity, fractions and blank input, then permits correcting it", () => {
   render(<SplitBillDialog open items={items} onOpenChange={vi.fn()} onSplitByItems={vi.fn()} onSplitEqually={vi.fn()} />);
   fireEvent.click(screen.getByRole("checkbox"));
   fireEvent.click(screen.getByRole("button",{name:"Tăng số lượng tách Cà phê tươi pha máy"}));
   expect(screen.getByRole("button",{name:"Tách 1 món"})).toBeDisabled();
   const input=screen.getByLabelText("Số lượng tách Cà phê tươi pha máy");
   for(const value of ["1.5","", "3"]){fireEvent.change(input,{target:{value}});expect(screen.getByRole("button",{name:"Tách 1 món"})).toBeDisabled();}
   fireEvent.change(input,{target:{value:"1"}});
   expect(screen.getByRole("button",{name:"Tách 1 món"})).toBeEnabled();
 });
});
