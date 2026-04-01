"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { UserProfile, Tenant, Branch } from "@/lib/types";
import type { User } from "@supabase/supabase-js";

// --- Types ---

interface AuthState {
  /** Supabase auth user */
  authUser: User | null;
  /** App-level profile (from profiles table) */
  user: UserProfile | null;
  tenant: Tenant | null;
  branches: Branch[];
  currentBranch: Branch | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  switchBranch: (branchId: string) => void;
  logout: () => Promise<void>;
}

// --- Context ---

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load profile, tenant, branches from Supabase
  const loadUserData = useCallback(
    async (authUser: User) => {
      try {
        // 1. Load profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", authUser.id)
          .single();

        if (!profile) {
          // Profile not yet created (handle_new_user trigger hasn't fired or failed)
          setUser(buildFallbackProfile(authUser));
          return;
        }

        setUser({
          id: profile.id,
          tenantId: profile.tenant_id,
          branchId: profile.branch_id ?? undefined,
          fullName: profile.full_name,
          email: profile.email,
          phone: profile.phone ?? undefined,
          role: profile.role,
          isActive: profile.is_active,
          createdAt: profile.created_at,
        });

        // 2. Load tenant
        const { data: tenantData } = await supabase
          .from("tenants")
          .select("*")
          .eq("id", profile.tenant_id)
          .single();

        if (tenantData) {
          setTenant({
            id: tenantData.id,
            name: tenantData.name,
            slug: tenantData.slug,
            settings: tenantData.settings as Record<string, unknown>,
            createdAt: tenantData.created_at,
          });
        }

        // 3. Load branches
        const { data: branchData } = await supabase
          .from("branches")
          .select("*")
          .eq("tenant_id", profile.tenant_id)
          .eq("is_active", true)
          .order("is_default", { ascending: false });

        if (branchData && branchData.length > 0) {
          const mappedBranches: Branch[] = branchData.map((b) => ({
            id: b.id,
            tenantId: b.tenant_id,
            name: b.name,
            address: b.address ?? undefined,
            phone: b.phone ?? undefined,
            isDefault: b.is_default,
            createdAt: b.created_at,
          }));
          setBranches(mappedBranches);

          // Set current branch: use profile.branch_id or default branch
          const savedBranchId = profile.branch_id;
          const currentBr =
            mappedBranches.find((b) => b.id === savedBranchId) ??
            mappedBranches.find((b) => b.isDefault) ??
            mappedBranches[0];
          setCurrentBranch(currentBr);
        }
      } catch {
        // If DB queries fail (e.g., tables not created yet), use fallback
        setUser(buildFallbackProfile(authUser));
      }
    },
    [supabase]
  );

  // Listen to Supabase auth state changes
  useEffect(() => {
    // Get initial session
    supabase.auth.getUser().then(({ data: { user: initialUser } }) => {
      if (initialUser) {
        setAuthUser(initialUser);
        loadUserData(initialUser).finally(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    });

    // Subscribe to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null;
      setAuthUser(sessionUser);

      if (sessionUser) {
        loadUserData(sessionUser);
      } else {
        setUser(null);
        setTenant(null);
        setBranches([]);
        setCurrentBranch(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, loadUserData]);

  const switchBranch = useCallback(
    (branchId: string) => {
      const branch = branches.find((b) => b.id === branchId);
      if (branch) {
        setCurrentBranch(branch);
      }
    },
    [branches]
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push("/dang-nhap");
  }, [supabase, router]);

  return (
    <AuthContext.Provider
      value={{
        authUser,
        user,
        tenant,
        branches,
        currentBranch,
        isLoading,
        isAuthenticated: !!authUser,
        switchBranch,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

// --- Fallback profile (when DB not ready) ---

function buildFallbackProfile(authUser: User): UserProfile {
  const meta = authUser.user_metadata ?? {};
  return {
    id: authUser.id,
    tenantId: "",
    fullName: meta.full_name ?? authUser.email?.split("@")[0] ?? "User",
    email: authUser.email ?? "",
    phone: meta.phone ?? null,
    role: "owner",
    isActive: true,
    createdAt: authUser.created_at,
  };
}
