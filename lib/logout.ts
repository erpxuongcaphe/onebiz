import { supabase } from './supabaseClient';

/**
 * Force logout — bullet-proof version.
 *
 * Why so aggressive?
 * - Auth session lives in cookies (cookieStorage adapter), NOT localStorage.
 * - supabase.auth.signOut() must run FIRST to stop the internal
 *   auto-refresh timer; otherwise the timer re-writes the cookie
 *   from the in-memory session cache even after we clear it.
 * - js-cookie helpers can silently fail to remove domain-scoped cookies,
 *   so we fall back to raw document.cookie manipulation.
 */
export async function forceLogout(): Promise<void> {
  // ── 1. signOut first — stops refresh timer + clears in-memory cache ──
  try {
    if (supabase) {
      await supabase.auth.signOut();
    }
  } catch {
    // network timeout / offline → continue with local cleanup
  }

  // ── 2. Nuke every cookie via document.cookie (bypasses js-cookie) ──
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const name = part.split('=')[0].trim();
    if (!name) continue;
    // Expire on current domain
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    // Expire on parent domain — covers subdomain-scoped cookies
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.onebiz.com.vn`;
  }

  // ── 3. Nuke localStorage (belt & suspenders) ──
  localStorage.clear();

  // ── 4. Hard redirect → full page reload, kills all React state ──
  window.location.href = '/login';
}
