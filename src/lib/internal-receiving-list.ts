import type {InternalReceivingOrder} from './services/supabase/internal-receiving';

export type ReceivingStatus = 'pending' | 'partial' | 'received' | 'legacy' | 'cancelled' | 'draft';
export const RECEIVING_STATUS_LABELS: Record<ReceivingStatus,string> = {
  pending:'Chưa nhận',partial:'Nhận một phần',received:'Đã nhận đủ',legacy:'Nhập tự động (cũ)',cancelled:'Đã hủy',draft:'Chưa xuất',
};
export function receivingStatus(order:InternalReceivingOrder):ReceivingStatus {
  if(order.status==='cancelled') return 'cancelled';
  if(order.status && order.status!=='completed') return 'draft';
  if(order.receiptMode==='legacy') return 'legacy';
  if(order.items.length && order.items.every(item=>item.received>=item.dispatched)) return 'received';
  return order.items.some(item=>item.received>0) ? 'partial' : 'pending';
}
export function receivingMetrics(order:InternalReceivingOrder) {
  return {items:order.items.length,pending:['cancelled','draft','legacy'].includes(receivingStatus(order))?0:order.items.filter(item=>item.received<item.dispatched).length,
    stock:order.items.filter(item=>(item.treatment??'stock')==='stock').length,
    expense:order.items.filter(item=>item.treatment==='expense').length,
    review:order.items.filter(item=>item.treatment==='review').length,
    receipts:order.receipts.length,lastReceived:order.receipts.reduce((last,r)=>r.createdAt>last?r.createdAt:last,''),
    receivers:[...new Set(order.receipts.map(r=>r.createdBy).filter(Boolean))].join(', ')};
}
export function vietnamReceivingDate(value:string) {
  return value ? new Date(new Date(value).getTime()+7*3600_000).toISOString().slice(0,10) : '';
}
export interface ReceivingListFilters {
  search:string;status:string;source:string;receiver:string;purpose:string;from:string;to:string;dateField:'created'|'received';
}
export const EMPTY_RECEIVING_FILTERS:ReceivingListFilters={search:'',status:'',source:'',receiver:'',purpose:'',from:'',to:'',dateField:'created'};
export function filterReceivingOrders(orders:InternalReceivingOrder[],f:ReceivingListFilters) {
  const query=f.search.trim().toLocaleLowerCase('vi');
  return orders.filter(order=>{
    const m=receivingMetrics(order),date=vietnamReceivingDate(f.dateField==='received'?m.lastReceived:order.createdAt);
    if(f.status && receivingStatus(order)!==f.status) return false;
    if(f.source && order.fromBranch!==f.source) return false;
    if(f.receiver && !order.receipts.some(r=>r.createdBy===f.receiver)) return false;
    if(f.purpose && !order.items.some(i=>(i.treatment??'stock')===f.purpose)) return false;
    if((f.from && (!date || date<f.from)) || (f.to && (!date || date>f.to))) return false;
    return !query || [order.code,order.fromBranch,order.toBranch,order.createdBy,order.note,m.receivers,
      ...order.items.flatMap(i=>[i.code,i.name]),...order.receipts.map(r=>r.note)].filter(Boolean).join(' ').toLocaleLowerCase('vi').includes(query);
  });
}
export function receivingSortValue(order:InternalReceivingOrder,key:string):string|number {
  const m=receivingMetrics(order);
  if(key in m) return m[key as keyof typeof m];
  if(key==='status') return RECEIVING_STATUS_LABELS[receivingStatus(order)];
  return String(order[key as keyof InternalReceivingOrder]??'');
}
