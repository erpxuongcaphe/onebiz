import { readFileSync, writeFileSync } from 'node:fs';
const source=readFileSync('supabase/migrations/00165_fnb_menu_lock_cascade_void_ledger.sql','utf8').replace(/\r\n/g,'\n');
const marker='create or replace function public.fnb_void_invoice_atomic(';
const start=source.indexOf(marker),end=source.indexOf('$$;',start);
if(start<0 || end<0 || !process.argv[2]) throw new Error('Void core boundary/output required');
writeFileSync(process.argv[2],source.slice(start,end+3).replace(marker,'create or replace function public._fnb_void_invoice_impl_00165('));
