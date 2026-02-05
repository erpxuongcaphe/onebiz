import Cookies from 'js-cookie';
import { supabase } from './supabaseClient';

const COOKIE_DOMAIN = '.onebiz.com.vn';
const isProduction = typeof window !== 'undefined' && window.location.hostname.includes('onebiz.com.vn');

/**
 * Force logout — clears cookie-based session (cookieStorage) + localStorage,
 * invalidates server session, then hard-redirects to /login.
 */
export async function forceLogout(): Promise<void> {
  // 1. Clear all Supabase cookies (session lives here via cookieStorage)
  const allCookies = Cookies.get();
  Object.keys(allCookies).forEach(key => {
    if (key.startsWith('supabase')) {
      Cookies.remove(key, {
        domain: isProduction ? COOKIE_DOMAIN : undefined,
        path: '/',
      });
    }
  });

  // 2. Belt-and-suspenders: clear localStorage too
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith('supabase')) {
      localStorage.removeItem(key);
    }
  }

  // 3. Invalidate server session (best-effort — cookies already wiped above)
  try {
    if (supabase) {
      await supabase.auth.signOut();
    }
  } catch {
    // Ignored: local state already cleared, server token will expire naturally
  }

  // 4. Hard redirect — forces full page reload, kills all React state
  window.location.href = '/login';
}
