import type { AppliedPromotion } from '@/lib/types/promotions';

/** A manual choice must stay eligible; never silently replace it with another program. */
export function selectFnbPromotionChoice(eligible: AppliedPromotion[], automatic: AppliedPromotion | null,
  selectedId: string | null | undefined, cleared: boolean): AppliedPromotion | null {
  if (selectedId) return eligible.find(c => c.promotion.id === selectedId && c.discountAmount > 0) ?? null;
  if (selectedId === null || cleared) return null;
  return automatic;
}
