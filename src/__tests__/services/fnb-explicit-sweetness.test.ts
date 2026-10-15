import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/services/supabase/base', () => ({
  getClient: () => ({ rpc }), getCurrentTenantId: vi.fn(),
  handleError: (error: {message: string}) => { throw new Error(error.message); },
}));
import { filterFnbRecipeSweetnessGroups, type ModifierGroup } from '@/lib/services/supabase/modifier-groups';
const group = (id: string, name: string) => ({id, name} as ModifierGroup);
describe('POS measured sweetness versus preparation notes', () => {
  beforeEach(() => rpc.mockReset());
  it('hides unconfigured sweetness but preserves ice and topping order', async () => {
    rpc.mockResolvedValue({data: [], error: null});
    const groups = [group('ice','Đá/Nóng'),group('sweet','Mức đường'),group('top','Topping')];
    expect(await filterFnbRecipeSweetnessGroups('product','branch',groups)).toEqual([groups[0],groups[2]]);
    expect(rpc).toHaveBeenCalledWith('get_fnb_exact_sweetness_groups_00544',{p_product_id:'product',p_branch_id:'branch'});
  });
  it('preserves measured milk tea and custom tea recipes', async () => {
    rpc.mockResolvedValue({data: ['milk','tea'], error: null});
    const groups = [group('milk','Mức ngọt'),group('tea','Mức đường - Hồng Trà')];
    expect(await filterFnbRecipeSweetnessGroups('product','branch',groups)).toEqual(groups);
  });
  it('does not turn a failed recipe lookup into note-only configuration', async () => {
    rpc.mockResolvedValue({data:null,error:{message:'network'}});
    await expect(filterFnbRecipeSweetnessGroups('product','branch',[group('sweet','Mức đường')])).rejects.toThrow('network');
  });
});
