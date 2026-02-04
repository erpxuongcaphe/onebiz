import { type Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

// ─── Session cache ──────────────────────────────────────────────
let _cachedSession: Session | null = null;
let _cachedAt = 0;
const SESSION_TTL_MS = 55 * 60 * 1000; // refresh 5 min before the 60-min token expiry

export async function getCachedSession(): Promise<Session | null> {
  if (!supabase) return null;

  const now = Date.now();
  if (_cachedSession && (now - _cachedAt) < SESSION_TTL_MS) {
    return _cachedSession;
  }

  const { data } = await supabase.auth.getSession();
  _cachedSession = data.session;
  _cachedAt = now;
  return _cachedSession;
}

// Invalidate cache (call after signOut)
export function clearSessionCache() {
  _cachedSession = null;
  _cachedAt = 0;
}

// ─── Retry wrapper ──────────────────────────────────────────────
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}
