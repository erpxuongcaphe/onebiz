import { supabase } from './supabaseClient';

/**
 * Force logout with explicit localStorage cleanup
 *
 * This function handles browser-specific localStorage cache issues
 * where stale Supabase tokens prevent proper logout.
 *
 * Strategy:
 * 1. Clear all Supabase localStorage keys manually
 * 2. Call Supabase signOut API to invalidate server session
 * 3. Hard redirect to /login (forces page reload, clears React state)
 *
 * @returns Promise<void>
 */
export async function forceLogout(): Promise<void> {
  try {
    // Step 1: Clear all Supabase localStorage keys
    // This fixes browser cache issues where signOut() doesn't clear tokens properly
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('supabase')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Step 2: Call Supabase signOut API
    if (supabase) {
      await supabase.auth.signOut();
    }
  } catch (error) {
    // Even if API fails, we've already cleared localStorage
    // This ensures logout works even offline
    console.error('Logout error:', error);

    // Fallback: Nuclear option - clear all localStorage
    try {
      localStorage.clear();
    } catch (clearError) {
      console.error('Failed to clear localStorage:', clearError);
    }
  } finally {
    // Step 3: Always redirect to login
    // Hard redirect (not navigate) forces page reload which:
    // - Clears all React state
    // - Prevents auto-restore from any remaining stale tokens
    // - Ensures clean slate for next login
    window.location.href = '/login';
  }
}
