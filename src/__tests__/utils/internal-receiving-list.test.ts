import {describe,it,expect} from 'vitest';
import {EMPTY_RECEIVING_FILTERS,filterReceivingOrders,receivingMetrics,receivingSortValue,receivingStatus,vietnamReceivingDate} from '@/lib/internal-receiving-list';
import type {InternalReceivingOrder} from '@/lib/services/supabase/internal-receiving';
const order:InternalReceivingOrder={id:'one',code:'NB-FIXTURE',createdAt:'2026-10-19T18:00:00Z',fromBranch:'Kho A',toBranch:'Quán B',invoiceId:'invoice',status:'completed',receiptMode:'actual',createdBy:'Người xuất',items:[{id:'milk',productId:'milk',code:'SKU-MILK',name:'Sữa đặc',unit:'Thùng',dispatched:2,received:1,treatment:'stock'},{id:'tool',productId:'tool',code:'SKU-TOOL',name:'Vật tư',unit:'Cái',dispatched:30,received:30,treatment:'expense'}],receipts:[{id:'r',createdAt:'2026-10-20T01:00:00Z',updatedAt:'2026-10-20T01:00:00Z',revision:1,createdBy:'Người nhận',items:[]}]};
describe('receiving management list',()=>{
  it('retains complete legacy and cancelled history by default',()=>{
    const all=[order,{...order,id:'legacy',receiptMode:'legacy' as const},{...order,id:'void',status:'cancelled' as const}];
    expect(filterReceivingOrders(all,EMPTY_RECEIVING_FILTERS)).toHaveLength(3);
    expect(all.map(receivingStatus)).toEqual(['partial','legacy','cancelled']);
  });
  it('filters status, purpose, warehouse, receiver and SKU together',()=>{
    expect(filterReceivingOrders([order],{...EMPTY_RECEIVING_FILTERS,status:'partial',purpose:'expense',source:'Kho A',receiver:'Người nhận',search:'SKU-MILK'})).toEqual([order]);
    expect(filterReceivingOrders([order],{...EMPTY_RECEIVING_FILTERS,purpose:'review'})).toEqual([]);
  });
  it('uses Vietnam dates and excludes never-received orders from receipt-date filters',()=>{
    expect(vietnamReceivingDate(order.createdAt)).toBe('2026-10-20');
    expect(filterReceivingOrders([order],{...EMPTY_RECEIVING_FILTERS,from:'2026-10-20',to:'2026-10-20'})).toHaveLength(1);
    expect(filterReceivingOrders([{...order,receipts:[]}],{...EMPTY_RECEIVING_FILTERS,dateField:'received',from:'2026-10-20'})).toHaveLength(0);
  });
  it('counts lines, not mixed units, and exposes numeric sort values',()=>{
    expect(receivingMetrics(order)).toMatchObject({items:2,pending:1,stock:1,expense:1,receipts:1});
    expect(receivingSortValue(order,'pending')).toBe(1);
    expect(receivingSortValue(order,'createdBy')).toBe('Người xuất');
  });
});
