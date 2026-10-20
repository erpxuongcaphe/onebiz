import {describe,expect,it} from 'vitest';
import {receivingMemoryKey,receivingPresetRange,receivingVietnamDay,internalReceivingViewSchema} from '@/lib/receiving-view-state';

describe('receiving calendar and memory boundaries',()=>{
  it('switches today at Vietnam midnight rather than UTC midnight',()=>{
    expect(receivingVietnamDay(new Date('2026-10-19T16:59:59Z'))).toBe('2026-10-19');
    expect(receivingVietnamDay(new Date('2026-10-19T17:00:00Z'))).toBe('2026-10-20');
    expect(receivingPresetRange('today','2026-10-20')).toEqual({from:'2026-10-20',to:'2026-10-20'});
    expect(receivingPresetRange('today','2026-10-21')).toEqual({from:'2026-10-21',to:'2026-10-21'});
    expect(receivingPresetRange('all','2026-10-20')).toEqual({from:undefined,to:undefined});
  });
  it('separates accounts, tenants, branches and document sources',()=>{
    const keys=[receivingMemoryKey('t','u','b','internal'),receivingMemoryKey('t','u2','b','internal'),receivingMemoryKey('t2','u','b','internal'),receivingMemoryKey('t','u','b2','internal'),receivingMemoryKey('t','u','b','supplier')];
    expect(new Set(keys).size).toBe(5);
    expect(receivingMemoryKey(undefined,'u','b','internal')).toBeUndefined();
  });
  it('rejects malformed or unbounded stored state',()=>{
    expect(internalReceivingViewSchema.safeParse({page:-1}).success).toBe(false);
    expect(internalReceivingViewSchema.safeParse({filters:{preset:'invalid'}}).success).toBe(false);
  });
});
