import { expect, it } from 'vitest';
import { normalizeTransactionEntry, scaleUnitPrice } from '@/lib/operational-uom';
import type { UOMConversion } from '@/lib/types';
const conversions=[{fromUnit:'Thùng',toUnit:'Lon',factor:12,isActive:true},{fromUnit:'Lon',toUnit:'G',factor:1000,isActive:true}] as UOMConversion[];
it('normalizes package quantities and cost together without changing the total',()=>{
 expect(normalizeTransactionEntry(2,120000,'Lon','Thùng',conversions)).toEqual({quantity:24,price:10000,unit:'Lon'});
 expect(scaleUnitPrice(10000,12)).toBe(120000);
 expect(normalizeTransactionEntry(500,10,'Lon','G',conversions)).toEqual({quantity:0.5,price:10000,unit:'Lon'});
});
it('never posts a rounded-to-zero quantity or a materially different value',()=>{
 expect(()=>normalizeTransactionEntry(0.001,10000,'Lon','G',conversions)).toThrow(/quá nhỏ/);
 expect(()=>normalizeTransactionEntry(0.15,100000,'Lon','G',conversions)).toThrow(/lệch thành tiền/);
 expect(()=>normalizeTransactionEntry(2,10000,'Lon','Kg',conversions)).toThrow(/quy đổi/);
});
