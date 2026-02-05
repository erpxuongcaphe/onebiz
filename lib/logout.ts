import { supabase } from './supabaseClient';

/**
 * Force logout — synchronous, fire-and-forget version.
 *
 * Critical design decisions:
 * - signOut() is intentionally NOT awaited.  In @supabase/supabase-js v2 it may
 *   internally attempt a token-refresh before POSTing /logout; that refresh can
 *   hang indefinitely (network dead, CORS, stale token).  Awaiting it blocks
 *   every line that follows — cookies never get cleared, redirect never fires.
 * - Cookie clearing uses BOTH max-age=0 AND expires epoch (browser compat).
 * - window.location.replace() is used so the browser does a hard navigation;
 *   React Router cannot intercept it.
 */
export function forceLogout(): void {
  // ── 1. Fire signOut in background (stops refresh timer + server revoke) ──
  //        Do NOT await — it may hang.  .catch() swallows unhandled rejection.
  try {
    if (supabase) {
      supabase.auth.signOut().catch(() => {});
    }
  } catch {
    // signOut() itself threw synchronously (shouldn't happen, but be safe)
  }

  // ── 2. Nuke every cookie via native document.cookie ──
  //        js-cookie's Cookies.remove() silently fails on domain-scoped cookies
  //        in some browsers, so we go native and try both max-age + expires.
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const name = part.split('=')[0].trim();
    if (!name) continue;
    // Current domain
    document.cookie = `${name}=;max-age=0;path=/`;
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    // Parent domain — covers *.onebiz.com.vn
    document.cookie = `${name}=;max-age=0;path=/;domain=.onebiz.com.vn`;
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.onebiz.com.vn`;
  }

  // ── 3. Nuke all web storage ──
  localStorage.clear();
  sessionStorage.clear();

  // ── 4. Hard navigate → kills every React component + JS state ──
  window.location.replace('/login');
}
