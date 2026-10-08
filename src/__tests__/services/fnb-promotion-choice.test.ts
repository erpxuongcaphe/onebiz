import { describe,it,expect } from 'vitest';
import { selectFnbPromotionChoice } from '@/lib/fnb-promotion-choice';
import type { AppliedPromotion } from '@/lib/types/promotions';
const auto={promotion:{id:'auto'},discountAmount:5000} as AppliedPromotion;
const employee={promotion:{id:'employee'},discountAmount:10000} as AppliedPromotion;
describe('FNB cashier program selection',()=>{
 it('uses ERP automatic policy until the cashier chooses',()=>expect(selectFnbPromotionChoice([employee],auto,undefined,false)).toBe(auto));
 it('allows eligible manual choice even when automatic application is off',()=>expect(selectFnbPromotionChoice([employee],null,'employee',false)).toBe(employee));
 it('does not substitute another program after the buyer becomes ineligible',()=>expect(selectFnbPromotionChoice([auto],auto,'employee',false)).toBeNull());
 it('keeps an explicit no-benefit choice',()=>expect(selectFnbPromotionChoice([employee],auto,null,false)).toBeNull());
 it('keeps the existing per-bill cleared preference',()=>expect(selectFnbPromotionChoice([employee],auto,undefined,true)).toBeNull());
});
