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
      // Avoid getting stuck forever if network/power issues hang auth calls.
      if (!isMounted) return;
      setLoading(false);
    }, 6000);

    supabase.auth.getSession().then(async ({ data }) => {
      if (!isMounted) return;
      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
      if (data.session) {
        const perms = await fetchMyPermissionPatterns();
        if (isMounted) setPermissionPatterns(perms);
      } else {
        setPermissionPatterns([]);
      }
      setLoading(false);
      window.clearTimeout(fallbackTimer);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession) {
        const perms = await fetchMyPermissionPatterns();
        setPermissionPatterns(perms);
      } else {
        setPermissionPatterns([]);
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
      window.clearTimeout(fallbackTimer);
      sub.subscription.unsubscribe();
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
