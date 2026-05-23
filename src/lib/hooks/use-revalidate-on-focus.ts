"use client";

/**
 * useRevalidateOnFocus — CEO 23/05/2026
 *
 * Trigger refetch callback khi tab visible lại HOẶC window focus lại.
 * Pattern industry-standard từ React Query / SWR.
 *
 * Lý do tồn tại:
 *   CEO báo bug "tạo data → F5 không thấy → navigate đi rồi quay lại
 *   mới thấy". Root cause hỗn hợp:
 *     1. Browser bfcache: F5 render snapshot cũ
 *     2. Branch context loading: fetchData chạy trước branch ready
 *     3. Database eventually-consistent: insert chưa commit khi reload
 *
 * Hook này refetch khi:
 *   - Tab quay lại visible (user switch tab về)
 *   - Window focus lại (user click vô window sau khi rời)
 *
 * → User chuyển trang khác rồi back → tab/focus event → callback chạy
 *   → list refresh → data mới hiện.
 *
 * KHÔNG fire khi mount lần đầu (đã có useEffect [fetchData] riêng).
 *
 * Cách dùng:
 *   const fetchData = useCallback(async () => { ... }, [...]);
 *   useEffect(() => { fetchData(); }, [fetchData]);
 *   useRevalidateOnFocus(fetchData);  // ← thêm 1 dòng này
 *
 * Throttle: nếu fire liên tiếp <1s thì skip để tránh spam request.
 */

import { useEffect, useRef } from "react";

const THROTTLE_MS = 1000;

export function useRevalidateOnFocus(
  callback: (() => void) | (() => Promise<void>),
  options: {
    /** Tắt hook (vd khi đang loading hoặc tab vô hiệu). Default `true`. */
    enabled?: boolean;
  } = {},
) {
  const { enabled = true } = options;
  const lastFired = useRef(0);
  const callbackRef = useRef(callback);

  // Update ref khi callback thay đổi (tránh re-bind listener)
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const handler = () => {
      // Chỉ fire khi tab thực sự visible (không phải khi prerender)
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastFired.current < THROTTLE_MS) return;
      lastFired.current = now;
      void callbackRef.current();
    };

    document.addEventListener("visibilitychange", handler);
    window.addEventListener("focus", handler);
    // Page show event (bfcache restore) — quan trọng cho F5 bug
    window.addEventListener("pageshow", handler);

    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("focus", handler);
      window.removeEventListener("pageshow", handler);
    };
  }, [enabled]);
}
