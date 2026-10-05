import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { rpc, toast } = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc }), handleError: (error: {message:string}) => { throw new Error(error.message); } }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast }) }));
import { saveModifierDisplayOrder, setCategoryModifierGroups, setProductModifierGroups } from "@/lib/services/supabase/modifier-groups";
import { ModifierDisplayOrderDialog } from "@/components/shared/dialogs/modifier-display-order-dialog";

const rows = [{id:'b', name:'Mức đá', sortOrder:3}, {id:'a', name:'Mức đường', sortOrder:4}];
beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({error:null}); });

describe("Order-only writes", () => {
  it("sends just ids and the original rank snapshot, with no price/default changes", async () => {
    await saveModifierDisplayOrder('groups',null,rows,['a','b']);
    expect(rpc).toHaveBeenCalledWith('save_fnb_modifier_display_order_atomic', {
      p_kind:'groups', p_parent_id:null, p_ids:['a','b'], p_snapshot:[{id:'a',sort_order:4},{id:'b',sort_order:3}],
    });
  });
  it("rejects duplicates or omitted rows before calling the server", async () => {
    await expect(saveModifierDisplayOrder('groups',null,rows,['a','a'])).rejects.toThrow();
    await expect(saveModifierDisplayOrder('groups',null,rows,['a'])).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("uses one guarded RPC for category and explicitly chosen product modes", async () => {
    await setCategoryModifierGroups('category',['b','a'],true);
    await setProductModifierGroups('product',['a','b'],false);
    expect(rpc).toHaveBeenNthCalledWith(1,'save_fnb_modifier_links_atomic',{p_target:'category',p_target_id:'category',p_group_ids:['b','a'],p_use_common_order:true});
    expect(rpc).toHaveBeenNthCalledWith(2,'save_fnb_modifier_links_atomic',{p_target:'product',p_target_id:'product',p_group_ids:['a','b'],p_use_common_order:false});
  });
  it("does not write when previewing and cancelling a reordered list", () => {
    const close=vi.fn();
    render(<ModifierDisplayOrderDialog kind="groups" title="Sắp xếp nhóm" rows={rows} onClose={close} onSaved={vi.fn()} />);
    expect(screen.getByRole('button',{name:'Lưu thứ tự'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Đưa Mức đường lên'}));
    fireEvent.click(screen.getByRole('button',{name:'Hủy'}));
    expect(rpc).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  });
  it("retains a stale draft, shows the conflict, and does not report success", async () => {
    rpc.mockResolvedValue({error:{message:'MODIFIER_ORDER_CONFLICT'}});
    const close=vi.fn(), saved=vi.fn();
    render(<ModifierDisplayOrderDialog kind="groups" title="Sắp xếp nhóm" rows={rows} onClose={close} onSaved={saved} />);
    fireEvent.click(screen.getByRole('button',{name:'Đưa Mức đường lên'}));
    fireEvent.click(screen.getByRole('button',{name:'Lưu thứ tự'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('máy khác');
    expect(close).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Mức đường');
  });
  it("blocks double save and reports a committed write separately from reload failure", async () => {
    let finish: (value:{error:null})=>void = () => {};
    rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const close=vi.fn();
    render(<ModifierDisplayOrderDialog kind="groups" title="Sắp xếp nhóm" rows={rows} onClose={close} onSaved={vi.fn().mockRejectedValue(new Error('offline'))} />);
    fireEvent.click(screen.getByRole('button',{name:'Đưa Mức đường lên'}));
    const save=screen.getByRole('button',{name:'Lưu thứ tự'});
    fireEvent.click(save); fireEvent.click(save);
    expect(rpc).toHaveBeenCalledOnce();
    finish({error:null});
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({title:'Thứ tự đã lưu',variant:'warning'}));
  });
});
