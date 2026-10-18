import { describe, expect, it } from 'vitest';
import { fnbDiscountContext, retailDiscountContext } from '@/lib/manager-discount-context';
import { getFnbBenefitDisplay } from '@/lib/fnb-benefit-display';
import type { FnbOrderLine } from '@/lib/types/fnb';
import type { OrderLine } from '@/app/pos/hooks/use-pos-state';
const fnb={id:'local',productId:'coffee',productName:'Coffee',quantity:2,unitPrice:50000,toppings:[],lineTotal:100000} as FnbOrderLine;
const retail={lineId:'local',productId:'coffee',productName:'Coffee',quantity:2,unitPrice:50000,unit:'Gói',discount:{mode:'amount',value:0}} as OrderLine;
describe('approval discount intent',()=>{
 it('binds unsent FnB intent without sending a kitchen request',()=>{const c=fnbDiscountContext('branch','draft','Mang về',undefined,[fnb],100000,{mode:'percent',value:100});expect(c).toMatchObject({draft_key:'draft',entity_id:null,amount:100000});expect(c.items[0]).not.toHaveProperty('id');});
 it('applies 100 percent to the remainder when a split bill already has a discount',()=>{expect(fnbDiscountContext('branch','draft','Bàn 1','ko',[fnb],100000,{mode:'percent',value:100},20000)).toMatchObject({entity_id:'ko',amount:80000,existing_discount:20000});});
 it('captures Retail line and order discounts together',()=>{const c=retailDiscountContext('b','session',[retail],{mode:'percent',value:10},{id:'local',discount:{mode:'amount',value:20000}});expect(c.amount).toBe(28000);expect(c.items[0].discount).toBe(20000);expect(c.bill_key).toBe('session');});
 it('uses the loaded draft identity for draft completion and retains the local session for UI checks',()=>{expect(retailDiscountContext('b','session',[retail],{mode:'amount',value:5000},undefined,false,true,'invoice-draft')).toMatchObject({session_id:'session',bill_key:'invoice-draft'});});
 it('does not spend additional promotion or coupon value on a fully complimentary bill',()=>{expect(getFnbBenefitDisplay({totalAfterManualDiscount:0,manualDiscountAmount:100000,promotionDiscountAmount:10000,couponDiscountAmount:20000})).toMatchObject({total:0,totalDiscountAmount:100000,promotionDiscountAmount:0,couponDiscountAmount:0});});
 it('keeps a non-complimentary conflict visible for validation instead of silently changing the requested discount',()=>{expect(getFnbBenefitDisplay({totalAfterManualDiscount:10000,manualDiscountAmount:90000,promotionDiscountAmount:20000})).toMatchObject({total:0,totalDiscountAmount:110000});});
});
