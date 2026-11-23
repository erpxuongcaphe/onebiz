import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TableBillsDialog } from "@/app/pos/fnb/components/table-bills-dialog";
import { TableActionSheet } from "@/components/shared/floor-plan/table-action-sheet";
import { getFnbTableBills, getSingleFnbTableBill, type FnbOpenOrder } from "@/lib/fnb-open-orders";
import type { FnbTabSnapshot } from "@/lib/types/fnb";
import type { CanvasTable } from "@/components/shared/floor-plan/floor-plan-canvas";

const orders=[{id:"a",orderNumber:"KB001",customerName:"Khách lẻ",itemCount:2,provisionalTotal:44000},{id:"b",orderNumber:"KB002",customerName:"Khách khác",itemCount:1,provisionalTotal:25000}] as FnbOpenOrder[];
function setup(busy=false,canMerge=true) {
 const opened=vi.fn(),merged=vi.fn(),created=vi.fn(),closed=vi.fn();
 function Fixture(){return <TableBillsDialog open tableLabel="Bàn 1" orders={orders} drafts={[]} loading={false} opening={false} busy={busy} canMerge={canMerge} onOpenChange={closed} onOpenOrder={opened} onOpenDraft={vi.fn()} onRefresh={vi.fn()} onCreate={created} onMerge={merged}/>;}
 render(<Fixture/>);return {opened,merged,created,closed};
}
describe("independent bills at one table",()=>{
 it("opens exactly the selected bill and creates a separate bill only on its explicit action",()=>{
  const callbacks=setup();fireEvent.click(screen.getByRole("button",{name:/KB002/}));expect(callbacks.opened).toHaveBeenCalledWith(orders[1]);expect(callbacks.merged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Bill mới cùng bàn"}));expect(callbacks.created).toHaveBeenCalledOnce();
 });
 it("opens the shared multiple-bill selector without merging a pair immediately",()=>{
  const callbacks=setup();fireEvent.click(screen.getByRole("button",{name:"Gộp 2 hoặc nhiều bill…"}));expect(callbacks.merged).toHaveBeenCalledOnce();expect(callbacks.opened).not.toHaveBeenCalled();
 });
 it("locks bill actions while merging and hides merge for unauthorized staff",()=>{
  const view=setup(true);expect(screen.getByRole("button",{name:"Bill mới cùng bàn"})).toBeDisabled();expect(screen.getByRole("button",{name:/KB001/})).toBeDisabled();expect(view.created).not.toHaveBeenCalled();
 });
 it("offers new bill on an occupied table as a distinct action",()=>{
  const onAction=vi.fn();render(<TableActionSheet table={{id:"table",status:"occupied",unpaidOrders:2,name:"Bàn 1"} as CanvasTable} onAction={onAction} onClose={vi.fn()} canCreateBill />);
  fireEvent.click(screen.getByRole("button",{name:"Bill mới cùng bàn"}));expect(onAction).toHaveBeenCalledWith("new_bill",expect.objectContaining({id:"table"}));
 });
 it("closes the read-only bill picker without treating merge choices as unsaved form data",()=>{
  const callbacks=setup();
  fireEvent.click(screen.getByRole("button",{name:"Đóng"}));
  expect(callbacks.closed).toHaveBeenCalledWith(false);expect(screen.queryByRole("dialog",{name:"Có nội dung chưa lưu"})).not.toBeInTheDocument();expect(callbacks.merged).not.toHaveBeenCalled();
 });
 it("does not show merge when the user lacks permission",()=>{setup(false,false);expect(screen.queryByRole("button",{name:"Gộp 2 hoặc nhiều bill…"})).not.toBeInTheDocument();});
});

describe("opening a single bill directly from the floor plan", () => {
  const current = { ...orders[0], tableId: "table", status: "served" } satisfies FnbOpenOrder;
  const other = { ...orders[1], tableId: "table", status: "pending" } satisfies FnbOpenOrder;
  const draft = { id: "draft", label: "Bill mới", tableId: "table", orderType: "dine_in", customerName: "", lines: [] } satisfies FnbTabSnapshot;
  const openable = (rows: FnbOpenOrder[], tabs: FnbTabSnapshot[] = [], currentOrderId: string | null = null) =>
    getSingleFnbTableBill(getFnbTableBills("table", rows, tabs), currentOrderId);

  it("opens the one unpaid bill even if it already has a local tab", () => {
    expect(openable([current, { ...other, tableId: "other-table" }], [{ ...draft, kitchenOrderId: current.id }], current.id))
      .toEqual({ order: current });
  });

  it("opens the only local draft when the table has no saved bill", () => {
    expect(openable([], [draft])).toEqual({ draftId: draft.id });
  });

  it("keeps the picker when the table has two bills, including a pending local draft", () => {
    expect(openable([current, other])).toBeNull();
    expect(openable([current], [draft])).toBeNull();
  });

  it("ignores paid or merged bills and keeps the picker if the floor-plan pointer disagrees", () => {
    expect(openable([{ ...current, invoiceId: "invoice" }, { ...other, mergedIntoId: "target" }])).toBeNull();
    expect(openable([current], [], "newer-order")).toBeNull();
    expect(openable([], [draft], "newer-order")).toBeNull();
  });
});
