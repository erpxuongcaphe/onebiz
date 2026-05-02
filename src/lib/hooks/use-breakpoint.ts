"use client";

import { useEffect, useState } from "react";

/**
 * useBreakpoint — match Tailwind breakpoints qua matchMedia.
 *
 * Trả về `true` khi viewport ≥ breakpoint. Re-render khi window resize
 * (qua matchMedia listener — rẻ hơn `resize` event listener).
 *
 * Dùng cho responsive shell logic (vd force sidebar collapsed ở tablet,
 * show/hide secondary content). Component-level responsive vẫn nên dùng
 * Tailwind classes (`md:flex`, `lg:hidden`) — hook này chỉ cho cases mà
 * CSS không đủ (vd portal positioning, force collapsed state).
 *
 * SSR-safe: trên server trả về `false` (default mobile-first).
 */

const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

export function useBreakpoint(bp: Breakpoint): boolean {
  const [match, setMatch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = `(min-width: ${BREAKPOINTS[bp]}px)`;
    const mql = window.matchMedia(query);
    const onChange = () => setMatch(mql.matches);
    onChange();
    // Modern browsers: addEventListener; legacy: addListener.
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } else {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  }, [bp]);

  return match;
}
