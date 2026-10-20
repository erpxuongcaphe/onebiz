import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TableBillsDialog } from "@/app/pos/fnb/components/table-bills-dialog";
import { TableActionSheet } from "@/components/shared/floor-plan/table-action-sheet";
import type { FnbOpenOrder } from "@/lib/fnb-open-orders";
import type { CanvasTable } from "@/components/shared/floor-plan/floor-plan-canvas";

const orders=[{id:"a",orderNumber:"KB001",customerName:"Khách lẻ",itemCount:2,provisionalTotal:44000},{id:"b",orderNumber:"KB002",customerName:"Khách khác",itemCount:1,provisionalTotal:25000}] as FnbOpenOrder[];
function setup(busy=false,canMerge=true) {
 const opened=vi.fn(),merged=vi.fn(),created=vi.fn(),closed=vi.fn();
 function Fixture(){const[source,setSource]=useState("");const[target,setTarget]=useState("");return <TableBillsDialog open tableLabel="Bàn 1" orders={orders} drafts={[]} loading={false} opening={false} busy={busy} canMerge={canMerge} online mergeSource={source} mergeTarget={target} onSourceChange={setSource} onTargetChange={setTarget} onOpenChange={closed} onOpenOrder={opened} onOpenDraft={vi.fn()} onRefresh={vi.fn()} onCreate={created} onMerge={merged}/>;}
 render(<Fixture/>);return {opened,merged,created,closed};
}
describe("independent bills at one table",()=>{
 it("opens exactly the selected bill and creates a separate bill only on its explicit action",()=>{
  const callbacks=setup();fireEvent.click(screen.getByRole("button",{name:/KB002/}));expect(callbacks.opened).toHaveBeenCalledWith(orders[1]);expect(callbacks.merged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Bill mới cùng bàn"}));expect(callbacks.created).toHaveBeenCalledOnce();
 });
 it("requires an explicit pair and confirmation before merging",()=>{
  const callbacks=setup();const submit=screen.getByRole("button",{name:"Xác nhận gộp hai bill đã chọn"});expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Bill nguồn để gộp"),{target:{value:"a"}});
  fireEvent.change(screen.getByLabelText("Bill đích để gộp"),{target:{value:"b"}});
  expect(submit).toBeEnabled();expect(callbacks.merged).not.toHaveBeenCalled();fireEvent.click(submit);expect(callbacks.merged).toHaveBeenCalledOnce();
 });
 it("locks bill actions while merging and hides merge for unauthorized staff",()=>{
  const view=setup(true);expect(screen.getByRole("button",{name:"Bill mới cùng bàn"})).toBeDisabled();expect(screen.getByRole("button",{name:/KB001/})).toBeDisabled();expect(view.created).not.toHaveBeenCalled();
 });
 it("offers new bill on an occupied table as a distinct action",()=>{
  const onAction=vi.fn();render(<TableActionSheet table={{id:"table",status:"occupied",unpaidOrders:2,name:"Bàn 1"} as CanvasTable} onAction={onAction} onClose={vi.fn()} canCreateBill />);
  fireEvent.click(screen.getByRole("button",{name:"Bill mới cùng bàn"}));expect(onAction).toHaveBeenCalledWith("new_bill",expect.objectContaining({id:"table"}));
 });
 it("closes the read-only bill picker without treating merge choices as unsaved form data",()=>{
  const callbacks=setup();fireEvent.change(screen.getByLabelText("Bill nguồn để gộp"),{target:{value:"a"}});
  fireEvent.click(screen.getByRole("button",{name:"Đóng"}));
  expect(callbacks.closed).toHaveBeenCalledWith(false);expect(screen.queryByRole("dialog",{name:"Có nội dung chưa lưu"})).not.toBeInTheDocument();expect(callbacks.merged).not.toHaveBeenCalled();
 });
 it("does not show merge when the user lacks permission",()=>{setup(false,false);expect(screen.queryByLabelText("Bill nguồn để gộp")).not.toBeInTheDocument();});
});
