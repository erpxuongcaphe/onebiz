"use client";

import { useEffect } from "react";
import { useFnbSubdomain } from "@/lib/hooks/use-fnb-subdomain";

/**
 * Dynamic PWA head tags + service worker registration.
 * On FnB subdomain: loads fnb manifest + registers fnb service worker.
 * On main domain: loads erp manifest (no service worker yet).
 */
export function PwaHead() {
  const { isFnb } = useFnbSubdomain();

  useEffect(() => {
    // Dynamically set manifest link
    const existing = document.querySelector('link[rel="manifest"]');
    if (existing) existing.remove();

    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = isFnb ? "/manifest-fnb.json" : "/manifest.json";
    document.head.appendChild(link);

    // Set theme-color meta
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute("content", isFnb ? "#0f172a" : "#2563eb");
    } else {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = isFnb ? "#0f172a" : "#2563eb";
      document.head.appendChild(meta);
    }

    // Register service worker for FnB
    if (isFnb && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw-fnb.js", { scope: "/" })
        .catch(() => {
          // Silent fail — SW registration is optional
        });
    }
  }, [isFnb]);

  // Set apple-mobile-web-app meta tags
  return (
    <>
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta
        name="apple-mobile-web-app-status-bar-style"
        content={isFnb ? "black-translucent" : "default"}
      />
      <meta
        name="apple-mobile-web-app-title"
        content={isFnb ? "FnB POS" : "OneBiz"}
      />
    </>
  );
}
