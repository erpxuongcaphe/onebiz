import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitBillDialog } from "@/app/pos/fnb/components/split-bill-dialog";

const items = [
  { id: "a", name: "Trà", quantity: 2, unitPrice: 35000, detail: "Ít đá" },
  { id: "b", name: "Cà phê", quantity: 1, unitPrice: 30000 },
];
describe("split bill context and truthful preview", () => {
  it("clears selection on reopen and prevents moving every remaining line", () => {
    const props={ items, onOpenChange:vi.fn(), onSplitByItems:vi.fn(), onSplitEqually:vi.fn() };
    const view=render(<SplitBillDialog {...props} open />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByRole("button",{name:"Tách 1 món"})).not.toBeDisabled();
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(screen.getByRole("button",{name:"Tách 2 món"})).toBeDisabled();
    view.rerender(<SplitBillDialog {...props} open={false} />);
    view.rerender(<SplitBillDialog {...props} open />);
    expect(screen.getAllByRole("checkbox").every(box=>!(box as HTMLInputElement).checked)).toBe(true);
  });
  it("shows actual line distribution instead of promising equal money", () => {
    render(<SplitBillDialog open items={items} onOpenChange={vi.fn()} onSplitByItems={vi.fn()} onSplitEqually={vi.fn()} />);
    fireEvent.click(screen.getByRole("button",{name:"Chia nhiều bill"}));
    expect(screen.queryByText("Mỗi người:")).not.toBeInTheDocument();
    expect(screen.getByText("Bill 1 (đang mở):")).toBeInTheDocument();
    expect(screen.getByText("70,000đ")).toBeInTheDocument();
    expect(screen.getByText("30,000đ")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Số bill"),{target:{value:"3"}});
    expect(screen.getByRole("button",{name:"Chia 3 phần"})).toBeDisabled();
  });
  it("keeps the dialog open on business failure and submits once", async () => {
    let finish!:(value:boolean)=>void;
    const submit=vi.fn(()=>new Promise<boolean>(resolve=>{ finish=resolve; }));
    const close=vi.fn();
    render(<SplitBillDialog open items={items} onOpenChange={close} onSplitByItems={submit} onSplitEqually={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    const button=screen.getByRole("button",{name:"Tách 1 món"});
    fireEvent.click(button); fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(1);
    finish(false);
    await waitFor(()=>expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(close).not.toHaveBeenCalled();
  });
});
