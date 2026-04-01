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
  /** App-level profile (from profiles table, mock for now) */
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

// --- Mock profile data (will be replaced by DB queries in Phase C) ---

function buildMockProfile(authUser: User): UserProfile {
  const meta = authUser.user_metadata ?? {};
  return {
    id: authUser.id,
    tenantId: "tenant_001",
    branchId: "branch_main",
    fullName: meta.full_name ?? authUser.email?.split("@")[0] ?? "User",
    email: authUser.email ?? "",
    phone: meta.phone ?? null,
    role: "owner",
    isActive: true,
    createdAt: authUser.created_at,
  };
}

const mockTenant: Tenant = {
  id: "tenant_001",
  name: "Cửa hàng ABC",
  slug: "cua-hang-abc",
  settings: {},
  createdAt: "2024-01-01",
};

const mockBranches: Branch[] = [
  {
    id: "branch_main",
    tenantId: "tenant_001",
    name: "Chi nhánh chính",
    address: "123 Nguyễn Huệ, Q1, TP.HCM",
    phone: "0909 123 456",
    isDefault: true,
    createdAt: "2024-01-01",
  },
  {
    id: "branch_hcm",
    tenantId: "tenant_001",
    name: "Chi nhánh HCM",
    address: "456 Lê Lợi, Q1, TP.HCM",
    phone: "0909 234 567",
    isDefault: false,
    createdAt: "2024-03-01",
  },
  {
    id: "branch_hn",
    tenantId: "tenant_001",
    name: "Chi nhánh HN",
    address: "789 Hoàn Kiếm, HN",
    phone: "0909 345 678",
    isDefault: false,
    createdAt: "2024-06-01",
  },
];

// --- Context ---

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [branches] = useState<Branch[]>(mockBranches);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(
    mockBranches[0]
  );
  const [isLoading, setIsLoading] = useState(true);

  // Listen to Supabase auth state changes
  useEffect(() => {
    // Get initial session
    supabase.auth.getUser().then(({ data: { user: initialUser } }) => {
      if (initialUser) {
        setAuthUser(initialUser);
        setUser(buildMockProfile(initialUser));
        setTenant(mockTenant);
        setCurrentBranch(mockBranches[0]);
      }
      setIsLoading(false);
    });

    // Subscribe to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null;
      setAuthUser(sessionUser);

      if (sessionUser) {
        setUser(buildMockProfile(sessionUser));
        setTenant(mockTenant);
        setCurrentBranch(mockBranches[0]);
      } else {
        setUser(null);
        setTenant(null);
        setCurrentBranch(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

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
