import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { buildCan, fetchMyPermissionPatterns, type PermissionPattern } from './rbac';

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isConfigured: boolean;
  permissionPatterns: PermissionPattern[];
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionPatterns, setPermissionPatterns] = useState<PermissionPattern[]>([]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    const fallbackTimer = window.setTimeout(() => {
      // Reduced timeout from 6s to 3s for faster initial load
      if (!isMounted) return;
      setLoading(false);
    }, 3000);

    // Get initial session
    supabase.auth.getSession().then(async ({ data }) => {
      if (!isMounted) return;
      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);

      // PRE-LOAD permissions from JWT synchronously (Option B - instant fix)
      if (data.session) {
        // ✅ Pre-load permissions from JWT IMMEDIATELY (no network delay)
        const jwtPerms = data.session.user.user_metadata?.permissions;
        if (Array.isArray(jwtPerms) && jwtPerms.length > 0) {
          console.log('[AuthProvider] Pre-loaded permissions from JWT:', jwtPerms);
          setPermissionPatterns(jwtPerms);
        }

        // Unlock UI with pre-loaded permissions (fast path)
        setLoading(false);
        window.clearTimeout(fallbackTimer);

        // Still fetch in background for validation/refresh (Option A)
        const perms = await fetchMyPermissionPatterns();
        console.log('[AuthProvider] Permissions refreshed:', perms);
        if (isMounted && perms.length > 0) {
          setPermissionPatterns(perms); // Update if changed after refresh
        }
      } else {
        setPermissionPatterns([]);
        setLoading(false);
        window.clearTimeout(fallbackTimer);
      }
    }).catch(() => {
      // If getSession fails, still show UI
      if (isMounted) {
        setLoading(false);
        window.clearTimeout(fallbackTimer);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession) {
        const perms = await fetchMyPermissionPatterns();
        console.log('[AuthProvider] Permissions refreshed:', perms);
        setPermissionPatterns(perms);
      } else {
        setPermissionPatterns([]);
      }
      setLoading(false);
    });

    // Option C: Listen for permission changes via Realtime (no re-login needed!)
    const channel = supabase
      .channel('permissions')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'user_roles' },
        async (payload) => {
          console.log('[AuthProvider] Permission change detected:', payload);
          // Refresh permissions in real-time
          const perms = await fetchMyPermissionPatterns();
          if (perms.length > 0) {
            console.log('[AuthProvider] Real-time permissions updated:', perms);
            setPermissionPatterns(perms);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      window.clearTimeout(fallbackTimer);
      sub.subscription.unsubscribe();
      channel.unsubscribe(); // Clean up Realtime listener
    };
  }, []);

  const can = useMemo(() => buildCan(permissionPatterns), [permissionPatterns]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      isConfigured: isSupabaseConfigured,
      permissionPatterns,
      can,
    }),
    [user, session, loading, permissionPatterns, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
