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
import { _seedProfileCache as seedProfileCache, _clearProfileCache as clearProfileCache } from "@/lib/services/supabase/base";
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
  /** Re-fetch profile + tenant + branches. Dùng sau khi user update /ho-so. */
  refreshProfile: () => Promise<void>;
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

        // PERF F11: Seed profile cache trong base.ts để service layer KHÔNG
        // refetch profile lần nữa. Trước đây AuthContext fetch profile (1) rồi
        // service đầu tiên gọi getCurrentTenantId() → fetch profile (2).
        // Giờ chia sẻ ngay → giảm 1 RTT/page nav.
        seedProfileCache({
          tenantId: profile.tenant_id,
          branchId: profile.branch_id ?? null,
          userId: profile.id,
        });

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
  // Track which user.id đã loadUserData rồi để dedup. onAuthStateChange fire
  // mỗi 50 phút (TOKEN_REFRESHED) + INITIAL_SESSION + USER_UPDATED — nếu
  // mỗi event đều fire loadUserData() → 5-17 lần fetch profile/tenant/branches
  // → cross-tab lock contention → "Lock broken by another request with the
  // 'steal' option" → toàn bộ services downstream throw.
  // Fix: chỉ load lại khi user.id THỰC SỰ đổi (signin/switch account).
  const loadedUserIdRef = useRef<string | null>(null);

  // Listen to Supabase auth state changes
  useEffect(() => {
    // Safety net: nếu getUser() hang 10s (network dropped, DNS fail, CORS),
    // force release spinner để user không thấy màn hình trắng vô hạn. Trước
    // đây getUser() thiếu .catch() → isLoading stuck forever → cả app render
    // null qua PermissionPage → CEO báo "web quay vòng".
    const initTimeoutId = setTimeout(() => {
      setIsLoading((current) => {
        if (current) {
          console.warn("[AuthProvider] Init timeout 10s — force release spinner");
        }
        return false;
      });
    }, 10_000);

    // PERF F2: Dùng getSession() thay vì getUser() trên mount.
    // - getSession() đọc session từ cookie/localStorage → INSTANT (0 RTT).
    // - getUser() luôn revalidate qua HTTP với Supabase server (200-400ms VN
    //   mobile). Cold start mỗi page nav phải chờ 1 RTT chỉ để biết "đã login".
    // - onAuthStateChange phía dưới sẽ fire SIGNED_IN nếu session refresh →
    //   loadUserData re-run (nhưng chỉ khi user.id thực sự đổi qua dedup).
    // - Edge case: session expired/tampered → loadUserData query với invalid
    //   token sẽ fail, RLS block → user bị redirect login. Chấp nhận risk
    //   này vì lợi ích 200-400ms perf cho 99% case happy path.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        const initialUser = session?.user ?? null;
        if (initialUser) {
          setAuthUser(initialUser);
          wasAuthenticatedRef.current = true;
          // PERF F13: Race condition fix — onAuthStateChange INITIAL_SESSION
          // có thể fire TRƯỚC getSession.then resolve (Supabase bắn event
          // ngay khi listener register nếu cookie hợp lệ). Trường hợp đó
          // listener đã loadUserData rồi → ở đây skip để tránh fetch profile
          // lần 2.
          if (loadedUserIdRef.current === initialUser.id) {
            // Đã load qua listener — chỉ release spinner.
            clearTimeout(initTimeoutId);
            setIsLoading(false);
            return;
          }
          loadedUserIdRef.current = initialUser.id;
          loadUserData(initialUser).finally(() => {
            clearTimeout(initTimeoutId);
            setIsLoading(false);
          });
        } else {
          clearTimeout(initTimeoutId);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        // Network fail, token invalid, CORS, DNS — treat như unauthenticated
        // thay vì để isLoading stuck true.
        console.error("[AuthProvider] getSession failed:", err);
        clearTimeout(initTimeoutId);
        setIsLoading(false);
      });

    // Subscribe to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const sessionUser = session?.user ?? null;
      setAuthUser(sessionUser);

      if (sessionUser) {
        wasAuthenticatedRef.current = true;
        // DEDUP: chỉ loadUserData khi user.id THỰC SỰ đổi (signin/switch
        // account) hoặc lần đầu (loadedUserIdRef chưa set). TOKEN_REFRESHED
        // / USER_UPDATED không cần re-fetch profile/tenant/branches vì data
        // không đổi — chỉ token đổi.
        if (loadedUserIdRef.current !== sessionUser.id) {
          loadedUserIdRef.current = sessionUser.id;
          // loadUserData có try/catch trong body — không throw lên đây.
          loadUserData(sessionUser);
        }
      } else {
        setUser(null);
        setTenant(null);
        setBranches([]);
        setCurrentBranch(null);
        setPermissions(new Set());
        // Reset dedup ref để lần sign-in tiếp theo sẽ load lại
        loadedUserIdRef.current = null;
        // PERF F11: Clear profile cache trong base.ts để service không trả
        // tenant cũ cho user mới (nếu admin switch account).
        clearProfileCache();

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

    return () => {
      clearTimeout(initTimeoutId);
      subscription.unsubscribe();
    };
  }, [supabase, loadUserData, router]);

  const switchBranch = useCallback(
    (branchId: string | null) => {
      // Defensive try/catch — switchBranch fire trong sync click handler.
      // Nếu throw đồng bộ (vd: localStorage.setItem fail vì quota), error
      // bubble lên error.tsx → root crash. Log + swallow để UI tiếp tục.
      try {
        // Device binding hard-stop — tablet đã khoá vào chi nhánh cụ thể,
        // không cho đổi. Staff bấm dropdown cũng silent no-op (UI đã lock).
        if (readDeviceBinding()) return;

        if (branchId === null) {
          // "Tất cả chi nhánh" — CEO view
          setCurrentBranch(null);
          try {
            localStorage.setItem("active_branch_id", "__all__");
          } catch {
            /* localStorage có thể bị block (private mode) */
          }
        } else {
          const branch = branches.find((b) => b.id === branchId);
          if (branch) {
            setCurrentBranch(branch);
            try {
              localStorage.setItem("active_branch_id", branchId);
            } catch {
              /* idem */
            }
          } else {
            console.warn(
              `[switchBranch] Không tìm thấy branch id="${branchId}" trong list ${branches.length} branches.`,
            );
          }
        }
      } catch (err) {
        console.error("[switchBranch] error:", err);
      }
    },
    [branches],
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

  // Re-fetch profile/tenant/branches. Dùng khi user update /ho-so hoặc khi
  // admin thay đổi role/branch từ trang khác — để UI (header, sidebar, permission)
  // sync ngay không cần reload.
  const refreshProfile = useCallback(async () => {
    if (!authUser) return;
    await loadUserData(authUser);
  }, [authUser, loadUserData]);

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
        refreshProfile,
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
    // phone tuy typed optional nhưng trước đây gán `null` → assign vào field
    // `string | undefined` strict TS → ok runtime nhưng `.replace()` / `.trim()`
    // trên null crash. Dùng undefined để consistent.
    phone: meta.phone ?? undefined,
    role: "owner",
    isActive: true,
    createdAt: authUser.created_at,
  };
}
