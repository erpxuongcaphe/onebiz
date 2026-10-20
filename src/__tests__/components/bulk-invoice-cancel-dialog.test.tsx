import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { preview, execute } = vi.hoisted(()=>({ preview:vi.fn(),execute:vi.fn() }));
vi.mock("@/components/ui/dialog",()=>({
  Dialog:({children,open}:{children:React.ReactNode;open:boolean})=>open?<div>{children}</div>:null,
  DialogContent:({children}:{children:React.ReactNode})=><div>{children}</div>,
  DialogHeader:({children}:{children:React.ReactNode})=><div>{children}</div>,
  DialogTitle:({children}:{children:React.ReactNode})=><h2>{children}</h2>,
  DialogFooter:({children}:{children:React.ReactNode})=><div>{children}</div>,
}));
vi.mock("@/lib/services/supabase/invoice-bulk-cancel",()=>({
  previewInvoiceBulkCancel:preview,executeInvoiceBulkCancel:execute,
  canCancelInvoice:(row:{source:string},p:{fnb:boolean;retail:boolean})=>row.source==="fnb"?p.fnb:p.retail,
}));
import { BulkInvoiceCancelDialog } from "@/components/shared/dialogs/bulk-invoice-cancel-dialog";
const ids=["a"], permissions={fnb:true,retail:false};
beforeEach(()=>{vi.clearAllMocks();preview.mockResolvedValue([{id:"a",code:"HD-A",status:"completed",source:"fnb",refund:55000,stockMovements:3}]);});
afterEach(cleanup);
describe("bulk invoice confirmation",()=>{
  it("requires both reason and acknowledgement; blocks duplicate clicks",async()=>{
    let finish!:()=>void;
    execute.mockImplementation(async(_rows,_reason,_perms,progress)=>{await new Promise<void>(resolve=>{finish=resolve;});progress({id:"a",code:"HD-A",ok:true,message:"Đã hủy"});return [];});
    const done=vi.fn().mockResolvedValue(undefined);
    render(<BulkInvoiceCancelDialog ids={ids} permissions={permissions} onClose={vi.fn()} onDone={done}/>);
    const button=await screen.findByRole("button",{name:"Xác nhận hủy 1 hóa đơn"});
    await waitFor(()=>expect(button).toBeDisabled());
    fireEvent.change(screen.getByLabelText("Lý do hủy hàng loạt"),{target:{value:"Nhập sai"}});
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));expect(button).toBeEnabled();
    fireEvent.click(button);fireEvent.click(button);
    expect(execute).toHaveBeenCalledTimes(1);
    finish();await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button",{name:/Xác nhận hủy/})).toBeNull();
  });
  it("does not enable confirmation when preview failed",async()=>{
    preview.mockRejectedValue(new Error("Không đọc được sổ"));
    render(<BulkInvoiceCancelDialog ids={ids} permissions={permissions} onClose={vi.fn()} onDone={vi.fn()}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không đọc được sổ");
    expect(screen.getByRole("button",{name:/Xác nhận hủy/})).toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
  });
});
