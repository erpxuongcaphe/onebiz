"use client";

import { useMemo } from "react";

/**
 * Detects if the app is running on the FnB subdomain (fnb.onebiz.com.vn).
 * Returns helper functions for URL routing on FnB subdomain.
 */
export function useFnbSubdomain() {
  const isFnb = useMemo(() => {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname;
    return host.startsWith("fnb.") || host.startsWith("fnb-");
  }, []);

  /** Convert internal path to FnB-appropriate path */
  const fnbPath = (path: string): string => {
    if (!isFnb) return path;
    // /pos/fnb → /
    if (path === "/pos/fnb" || path === "/pos/fnb/") return "/";
    // /pos/fnb/kds → /kds
    if (path.startsWith("/pos/fnb/")) return path.replace("/pos/fnb", "");
    return path;
  };

  return { isFnb, fnbPath };
}
