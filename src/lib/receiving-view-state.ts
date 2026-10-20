import {z} from 'zod';
import {computeListPresetRange, STANDARD_LIST_PRESETS_WITH_ALL} from '@/lib/utils/list-date-preset-range';
import type {DatePresetValue} from '@/components/shared/filter-sidebar';

export function receivingVietnamDay(now = new Date()) {
  return new Date(now.getTime()+7*60*60*1000).toISOString().slice(0,10);
}
export function receivingPresetRange(preset:DatePresetValue, day=receivingVietnamDay()) {
  return computeListPresetRange(preset,new Date(`${day}T12:00:00`));
}
export function receivingMemoryKey(tenant:string|undefined,user:string|undefined,branch:string,source:string) {
  return tenant&&user ? `onebiz_receiving_view_v1:${tenant}:${user}:${branch}:${source}` : undefined;
}
const text=z.string().max(1000);
export const receivingPresetSchema=z.custom<DatePresetValue>(value=>STANDARD_LIST_PRESETS_WITH_ALL.some(p=>p.value===value));
const page=z.number().int().min(0).max(1000000);
const size=z.number().int().min(1).max(500);
const sorting=z.array(z.object({id:text,desc:z.boolean()})).max(16);
export const internalReceivingViewSchema=z.object({
  filters:z.object({search:text,status:z.enum(['','pending','partial','received','legacy','cancelled','draft']),source:text,receiver:text,purpose:z.enum(['','stock','expense','review']),from:text,to:text,dateField:z.enum(['created','received']),preset:receivingPresetSchema}),
  sorting,page,size,full:z.boolean(),
});
export const supplierReceivingViewSchema=z.object({
  search:text,searchField:z.enum(['all','code','supplier_name']),page,pageSize:size,
  selectedStatuses:z.array(z.enum(['draft','ordered','partial','completed','cancelled'])).max(5),
  datePreset:receivingPresetSchema,dateFrom:text,dateTo:text,creatorFilter:text,importerFilter:text,
  costReturnFilter:z.enum(['all','has_cost','no_cost']),viewMode:z.enum(['list','kanban']),
  boardSort:z.enum(['oldest','newest','debt']),sorting:sorting.max(1),
});
