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

  /**
   * Sprint UI-FIX (CEO 08/05): Build URL FULL đến FnB subdomain.
   * Dùng cho button "POS F&B" trên trang chủ — khi user click, browser
   * navigate sang subdomain riêng (fnb.onebiz.com.vn) thay vì rewrite
   * trong cùng tab dưới URL `onebiz.com.vn/pos/fnb`.
   *
   * Behavior theo host:
   *   - On fnb.* → relative path (đã ở subdomain rồi)
   *   - On onebiz.com.vn | www.onebiz.com.vn (trang chính của tenant) →
   *     full URL `https://fnb.onebiz.com.vn{path}` để cross-subdomain nav
   *   - Localhost / vercel preview → giữ `/pos/fnb{path}` (không có subdomain
   *     riêng để switch)
   *
   * @param subPath sub path SAU /pos/fnb. Default = "" → trang chủ FnB.
   *   VD posFnbUrl() = "https://fnb.onebiz.com.vn/"
   *      posFnbUrl("/kds") = "https://fnb.onebiz.com.vn/kds"
   */
  const posFnbUrl = (subPath: string = ""): string => {
    if (typeof window === "undefined") return `/pos/fnb${subPath}`;
    const host = window.location.hostname;

    // Already on fnb subdomain → relative
    if (host.startsWith("fnb.") || host.startsWith("fnb-")) {
      return subPath === "" ? "/" : subPath;
    }

    // Production root domain → full URL sang fnb subdomain
    if (host === "onebiz.com.vn" || host === "www.onebiz.com.vn") {
      const protocol = window.location.protocol;
      return `${protocol}//fnb.onebiz.com.vn${subPath === "" ? "/" : subPath}`;
    }

    // Vercel preview / localhost / dev → fallback in-app routing
    return `/pos/fnb${subPath}`;
  };

  return { isFnb, fnbPath, posFnbUrl };
}
