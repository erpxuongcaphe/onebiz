import { describe, expect, it } from 'vitest';
import { finishKitchenSubmissionTabs } from '@/app/pos/fnb/hooks/kitchen-submission-tabs';
import type { FnbTabSnapshot } from '@/lib/types/fnb';

const draft = (id: string): FnbTabSnapshot => ({ id, label: 'Mang về', orderType: 'takeaway', customerName: 'Khách lẻ', lines: [] });
const saved = { ...draft('saved'), kitchenOrderId: 'server-order' };
describe('confirmed kitchen submission', () => {
  it('closes saved bill and reuses an empty cart without closing other bills', () => {
    const other = { ...draft('other'), kitchenOrderId: 'other-order' };
    expect(finishKitchenSubmissionTabs([saved, other, draft('empty')], saved.id, saved.id, draft('fresh')))
      .toEqual({ tabs: [other, draft('empty')], activeId: 'empty' });
  });
  it('creates empty cart when all remaining bills contain saved orders', () => {
    const other = { ...draft('other'), kitchenOrderId: 'other-order' };
    expect(finishKitchenSubmissionTabs([saved, other], saved.id, saved.id, draft('fresh')))
      .toEqual({ tabs: [other, draft('fresh')], activeId: 'fresh' });
  });
  it('does not discard an unsaved draft or lines added while submission was pending', () => {
    const unsent = draft('unsent');
    expect(finishKitchenSubmissionTabs([unsent], unsent.id, unsent.id, draft('fresh')).tabs).toEqual([unsent]);
    const changed = { ...saved, lines: [{ id: 'new' } as FnbTabSnapshot['lines'][number]] };
    expect(finishKitchenSubmissionTabs([changed], changed.id, changed.id, draft('fresh')).tabs).toEqual([changed]);
  });
  it('preserves another bill the cashier selected during the request', () => {
    const other = draft('other');
    expect(finishKitchenSubmissionTabs([saved, other], saved.id, other.id, draft('fresh')))
      .toEqual({ tabs: [other], activeId: other.id });
  });
});
