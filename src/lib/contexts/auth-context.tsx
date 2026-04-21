"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { UserProfile, Tenant, Branch } from "@/lib/types";
import type { User } from "@supabase/supabase-js";
import { getUserPermissions } from "@/lib/services/supabase/roles";
import { readDeviceBinding } from "@/lib/hooks/use-device-binding";

// --- Types ---

interface AuthState {
  /** Supabase auth user */
  authUser: User | null;
  /** App-level profile (from profiles table) */
  user: UserProfile | null;
  tenant: Tenant | null;
  branches: Branch[];
  currentBranch: Branch | null;
  /** Cached permission codes for current user */
  permissions: Set<string>;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  /** Switch to a specific branch, or null = "Tất cả chi nhánh" (CEO view) */
  switchBranch: (branchId: string | null) => void;
  /** Branch ID to filter data queries — undefined means show all branches */
  activeBranchId: string | undefined;
  /** Check if current user has a specific permission */
  hasPermission: (code: string) => boolean;
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
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  // Load profile, tenant, branches from Supabase
  const loadUserData = useCallback(
    async (authUser: User) => {
      try {
        // 1. Profile TRƯỚC — các query khác cần profile.tenant_id + profile.id.
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

        const userProfile: UserProfile = {
          id: profile.id,
          tenantId: profile.tenant_id,
          branchId: profile.branch_id ?? undefined,
          roleId: profile.role_id ?? undefined,
          fullName: profile.full_name,
          email: profile.email,
          phone: profile.phone ?? undefined,
          role: profile.role,
          isActive: profile.is_active,
          createdAt: profile.created_at,
        };
        setUser(userProfile);

        // 2-4. Song song hoá tenant + branches + permissions — trước đây 3 call
        // tuần tự làm cold start 1.5-2s, blocking toàn bộ AuthProvider render.
        // Owner skip getUserPermissions (có wildcard "*").
        const permsPromise =
          profile.role === "owner"
            ? Promise.resolve<Set<string>>(new Set(["*"]))
            : getUserPermissions(profile.id).catch(() => new Set<string>());

        const [tenantRes, branchRes, perms] = await Promise.all([
          supabase
            .from("tenants")
            .select("*")
            .eq("id", profile.tenant_id)
            .single(),
          supabase
            .from("branches")
            .select("*")
            .eq("tenant_id", profile.tenant_id)
            .eq("is_active", true)
            .order("is_default", { ascending: false }),
          permsPromise,
        ]);

        setPermissions(perms);

        const tenantData = tenantRes.data;
        if (tenantData) {
          setTenant({
            id: tenantData.id,
            name: tenantData.name,
            slug: tenantData.slug,
            settings: tenantData.settings as Record<string, unknown>,
            createdAt: tenantData.created_at,
          });
        }

        const branchData = branchRes.data;
        if (branchData && branchData.length > 0) {
          const mappedBranches: Branch[] = branchData.map((b) => ({
            id: b.id,
            tenantId: b.tenant_id,
            name: b.name,
            // Fallback "store" cho chi nhánh cũ chưa set branch_type (backward compat).
            branchType: (b.branch_type ?? "store") as Branch["branchType"],
            code: b.code ?? undefined,
            address: b.address ?? undefined,
            phone: b.phone ?? undefined,
            isDefault: b.is_default,
            createdAt: b.created_at,
          }));
          setBranches(mappedBranches);

          // Device binding: nếu admin đã bind tablet này vào 1 chi nhánh cố
          // định → force currentBranch về branch đó, bỏ qua localStorage +
          // profile.branch_id. Chỉ nếu branch đã bind vẫn tồn tại trong tenant
          // (tránh tablet zombie trỏ tới branch đã xoá).
          const binding = readDeviceBinding();
          const boundBranch = binding
            ? mappedBranches.find((b) => b.id === binding.branchId)
            : undefined;

          if (boundBranch) {
            setCurrentBranch(boundBranch);
          } else {
            // Set current branch: localStorage > profile.branch_id > default
            let storedBranchId: string | null = null;
            try { storedBranchId = localStorage.getItem("active_branch_id"); } catch {}

            if (storedBranchId === "__all__") {
              // CEO previously selected "Tất cả chi nhánh"
              setCurrentBranch(null);
            } else {
              const currentBr =
                mappedBranches.find((b) => b.id === storedBranchId) ??
                mappedBranches.find((b) => b.id === profile.branch_id) ??
                mappedBranches.find((b) => b.isDefault) ??
                mappedBranches[0];
              setCurrentBranch(currentBr);
            }
          }
        }
      } catch {
        // If DB queries fail (e.g., tables not created yet), use fallback
        setUser(buildFallbackProfile(authUser));
      }
    },
    [supabase]
  );

  // Track previous auth state to detect forced sign-outs (token expired)
  // vs initial unauthenticated state.
  const wasAuthenticatedRef = useRef(false);
  // Flag set by explicit logout() to suppress "session expired" toast —
  // user-initiated logout shouldn't show a warning.
  const userLogoutRef = useRef(false);

  // Listen to Supabase auth state changes
  useEffect(() => {
    // Get initial session
    supabase.auth.getUser().then(({ data: { user: initialUser } }) => {
      if (initialUser) {
        setAuthUser(initialUser);
        wasAuthenticatedRef.current = true;
        loadUserData(initialUser).finally(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    });

    // Subscribe to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const sessionUser = session?.user ?? null;
      setAuthUser(sessionUser);

      if (sessionUser) {
        wasAuthenticatedRef.current = true;
        loadUserData(sessionUser);
      } else {
        setUser(null);
        setTenant(null);
        setBranches([]);
        setCurrentBranch(null);
        setPermissions(new Set());

        // Nếu trước đó đã đăng nhập và bây giờ session mất (token hết hạn,
        // refresh fail, logout từ device khác) → notify + redirect. Bỏ qua
        // case logout chủ động (đã redirect từ logout() rồi).
        const wasAuthenticated = wasAuthenticatedRef.current;
        const userInitiated = userLogoutRef.current;
        wasAuthenticatedRef.current = false;
        userLogoutRef.current = false;

        if (wasAuthenticated && !userInitiated && event === "SIGNED_OUT") {
          // Dispatch event — ToastProvider sibling sẽ show toast.
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("auth:session-expired"));
          }
          // Redirect to login so user re-auths thay vì stuck silent 401.
          router.replace("/dang-nhap");
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, loadUserData, router]);

  const switchBranch = useCallback(
    (branchId: string | null) => {
      // Device binding hard-stop — tablet đã khoá vào chi nhánh cụ thể,
      // không cho đổi. Staff bấm dropdown cũng silent no-op (UI đã lock).
      if (readDeviceBinding()) return;

      if (branchId === null) {
        // "Tất cả chi nhánh" — CEO view
        setCurrentBranch(null);
        try { localStorage.setItem("active_branch_id", "__all__"); } catch {}
      } else {
        const branch = branches.find((b) => b.id === branchId);
        if (branch) {
          setCurrentBranch(branch);
          try { localStorage.setItem("active_branch_id", branchId); } catch {}
        }
      }
    },
    [branches]
  );

  // Derived: branchId for data queries (undefined = no filter = all branches)
  const activeBranchId = currentBranch?.id;

  // Permission check helper
  const hasPermission = useCallback(
    (code: string): boolean => {
      if (user?.role === "owner") return true;
      if (permissions.has("*")) return true;
      return permissions.has(code);
    },
    [user?.role, permissions]
  );

  const logout = useCallback(async () => {
    // Flag để SIGNED_OUT handler biết đây là user-initiated, không show
    // toast "session expired".
    userLogoutRef.current = true;
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
        permissions,
        isLoading,
        isAuthenticated: !!authUser,
        switchBranch,
        activeBranchId,
        hasPermission,
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
