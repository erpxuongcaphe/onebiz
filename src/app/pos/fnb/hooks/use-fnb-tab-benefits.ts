"use client";

import { useCallback, useState } from "react";
import type { AppliedPromotion } from "@/lib/services/supabase/promotion-engine";

export interface FnbCouponPreview {
  code: string;
  discount: number;
}

function replaceForTab<T>(
  current: Record<string, T>,
  tabId: string,
  value: T | null,
): Record<string, T> {
  if (value === null) {
    const { [tabId]: _removed, ...remaining } = current;
    return remaining;
  }
  return { ...current, [tabId]: value };
}

/**
 * Promotion and coupon previews are only previews: V3 recalculates their
 * value on the server. They still belong to one POS tab, never to the whole
 * screen, so switching tabs cannot charge another order's benefit.
 */
export function useFnbTabBenefits(activeTabId: string | null) {
  const [couponsByTabId, setCouponsByTabId] = useState<Record<string, FnbCouponPreview>>({});
  const [promotionsByTabId, setPromotionsByTabId] = useState<Record<string, AppliedPromotion>>({});
  const [clearedPromotionsByTabId, setClearedPromotionsByTabId] = useState<Record<string, true>>({});

  const setCouponForTab = useCallback((tabId: string, coupon: FnbCouponPreview | null) => {
    setCouponsByTabId((current) => replaceForTab(current, tabId, coupon));
  }, []);

  const setPromotionForTab = useCallback((tabId: string, promotion: AppliedPromotion | null) => {
    setPromotionsByTabId((current) => replaceForTab(current, tabId, promotion));
  }, []);

  const setPromotionClearedForTab = useCallback((tabId: string, cleared: boolean) => {
    if (cleared) {
      setPromotionsByTabId((current) => replaceForTab(current, tabId, null));
    }
    setClearedPromotionsByTabId((current) =>
      cleared
        ? { ...current, [tabId]: true }
        : replaceForTab(current, tabId, null),
    );
  }, []);

  const clearTabBenefits = useCallback((tabId: string) => {
    setCouponsByTabId((current) => replaceForTab(current, tabId, null));
    setPromotionsByTabId((current) => replaceForTab(current, tabId, null));
    setClearedPromotionsByTabId((current) => replaceForTab(current, tabId, null));
  }, []);

  return {
    couponApplied: activeTabId ? couponsByTabId[activeTabId] ?? null : null,
    appliedPromotion: activeTabId ? promotionsByTabId[activeTabId] ?? null : null,
    promotionCleared: activeTabId ? clearedPromotionsByTabId[activeTabId] === true : false,
    setCouponForTab,
    setPromotionForTab,
    setPromotionClearedForTab,
    clearTabBenefits,
  };
}
