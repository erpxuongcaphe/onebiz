"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { UserProfile, Tenant, Branch } from "@/lib/types";

// --- Types ---

interface AuthState {
  user: UserProfile | null;
  tenant: Tenant | null;
  branches: Branch[];
  currentBranch: Branch | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  /** Switch current branch */
  switchBranch: (branchId: string) => void;
  /** Mock login (will be replaced by Supabase in Phase B) */
  login: (email: string, password: string) => Promise<boolean>;
  /** Logout and clear session */
  logout: () => void;
}

// --- Mock data ---

const mockUser: UserProfile = {
  id: "usr_001",
  tenantId: "tenant_001",
  branchId: "branch_main",
  fullName: "Nguyễn Văn A",
  email: "admin@onebiz.vn",
  phone: "0909 123 456",
  role: "owner",
  isActive: true,
  createdAt: "2024-01-01",
};

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
  const [user, setUser] = useState<UserProfile | null>(mockUser);
  const [tenant, setTenant] = useState<Tenant | null>(mockTenant);
  const [branches] = useState<Branch[]>(mockBranches);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(
    mockBranches[0]
  );
  const [isLoading, setIsLoading] = useState(false);

  const switchBranch = useCallback(
    (branchId: string) => {
      const branch = branches.find((b) => b.id === branchId);
      if (branch) {
        setCurrentBranch(branch);
      }
    },
    [branches]
  );

  const login = useCallback(
    async (_email: string, _password: string): Promise<boolean> => {
      setIsLoading(true);
      // Mock: simulate login delay
      await new Promise((r) => setTimeout(r, 800));
      setUser(mockUser);
      setTenant(mockTenant);
      setCurrentBranch(mockBranches[0]);
      setIsLoading(false);
      return true;
    },
    []
  );

  const logout = useCallback(() => {
    setUser(null);
    setTenant(null);
    setCurrentBranch(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        tenant,
        branches,
        currentBranch,
        isLoading,
        isAuthenticated: !!user,
        switchBranch,
        login,
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
