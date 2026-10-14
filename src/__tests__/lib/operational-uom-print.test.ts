import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({read:vi.fn(),result:{data:[] as any[],error:null as any}}));
vi.mock('@/lib/services/supabase/base',()=>({getCurrentTenantId:async()=>'tenant',getClient:()=>({from:(table:string)=>{
 state.read(table);const q:any={select:()=>q,eq:()=>q,limit:()=>Promise.resolve(state.result)};return q;
}})}));
import {withOperationalPrintUnits} from '@/lib/operational-uom-print';
const base={documentType:'LỆNH SẢN XUẤT',documentCode:'SX0001',date:'2026-10-12',headerFields:[]};
beforeEach(()=>{state.read.mockClear();state.result={data:[],error:null};});
it('uses historical entered units for stock document printing',async()=>{
 state.result.data=[{snapshots:[{productName:'Thạch',inputQuantity:550,inputUnit:'G',stockQuantity:.5,stockUnit:'Mẻ'}]}];
 const printed=await withOperationalPrintUnits(base,'production_order');
 expect(printed.headerFields?.[0].value).toBe('Thạch: 550 G → 0.5 Mẻ');
 expect(base.headerFields).toHaveLength(0);
});
it('does not query or delay POS and kitchen printing',async()=>{
 expect(await withOperationalPrintUnits(base,'sale_invoice')).toBe(base);
 expect(await withOperationalPrintUnits(base,'kitchen_ticket')).toBe(base);
 expect(state.read).not.toHaveBeenCalled();
});
it('keeps legacy documents when no historical snapshot exists',async()=>{
 expect(await withOperationalPrintUnits(base,'disposal')).toBe(base);
});
