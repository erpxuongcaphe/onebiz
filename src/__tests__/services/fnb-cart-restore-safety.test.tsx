import React, { StrictMode } from 'react';
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const storage=vi.hoisted(()=>({load:vi.fn(),save:vi.fn(),clear:vi.fn()}));
vi.mock('@/app/pos/fnb/hooks/persist-tabs',()=>({loadPersistedTabs:storage.load,savePersistedTabs:storage.save,clearPersistedTabs:storage.clear}));
import { useFnbPosState } from '@/app/pos/fnb/hooks/use-fnb-pos-state';
const snapshot={tabs:[{id:'saved',label:'SN 06',orderType:'dine_in' as const,customerName:'Khách lẻ',lines:[{id:'line',productId:'coffee',productName:'Coffee',quantity:1,unitPrice:42000,lineTotal:42000,toppings:[]}],sentLines:[],kitchenOrderId:'order'}],activeTabId:'saved'};
describe('F&B durable cart startup',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();storage.save.mockResolvedValue(undefined);storage.clear.mockResolvedValue(undefined);});
 afterEach(()=>{cleanup();vi.useRealTimers();});
 it('does not clear an existing cart while its storage read is slow',async()=>{
  let resolve!:(v:typeof snapshot)=>void;
  storage.load.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const {result}=renderHook(()=>useFnbPosState('premium'));
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(storage.clear).not.toHaveBeenCalled();expect(storage.save).not.toHaveBeenCalled();
  await expect(result.current.flushPersistedTabs(true)).rejects.toThrow('Đang khôi phục');
  await act(async()=>resolve(snapshot));
  expect(result.current.activeTabId).toBe('saved');
  await act(async()=>{await vi.advanceTimersByTimeAsync(500);});
  expect(storage.save).toHaveBeenCalledWith('premium',expect.arrayContaining([expect.objectContaining({id:'saved'})]),'saved');
 });
 it('keeps the previous snapshot untouched when reading fails',async()=>{
  storage.load.mockRejectedValue(new Error('storage read failed'));
  const {result}=renderHook(()=>useFnbPosState('premium'));
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(storage.clear).not.toHaveBeenCalled();expect(storage.save).not.toHaveBeenCalled();
  await expect(result.current.flushPersistedTabs(true)).rejects.toThrow('storage read failed');
 });
 it('preserves saved bills and a new tab created while restoration is pending',async()=>{
  let resolve!:(v:typeof snapshot)=>void;
  storage.load.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const {result}=renderHook(()=>useFnbPosState('premium'));
  let created='';act(()=>{created=result.current.createTab('New guest','takeaway');});
  await act(async()=>resolve(snapshot));
  expect(result.current.tabs.map(tab=>tab.id)).toContain('saved');
  expect(result.current.activeTabId).toBe(created);
 });
 it('restores after an effect cleanup/replay rather than permanently skipping the read',async()=>{
  storage.load.mockResolvedValue(snapshot);
  const {result}=renderHook(()=>useFnbPosState('premium'),{wrapper:({children})=><StrictMode>{children}</StrictMode>});
  await act(async()=>{});
  expect(result.current.activeTabId).toBe('saved');
 });
});
