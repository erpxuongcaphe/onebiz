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
// CEO 22/05/2026 (Phase 2): per-user permission overrides
import { getUserEffectivePermissions } from "@/lib/services/supabase/permission-overrides";
import { _seedProfileCache as seedProfileCache, _clearProfileCache as clearProfileCache } from "@/lib/services/supabase/base";
import { readDeviceBinding } from "@/lib/hooks/use-device-binding";
import { isInternalAuthEmail } from "@/lib/auth/user-identifiers";
import { canViewAllBranches, parseAccessibleBranchIds } from "@/lib/auth/branch-scope";

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
  authDataError: string | null;
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

// Sprint LT-6 (CEO 27/05/2026): 30-day HARD session timeout.
// CEO yêu cầu user không bị đá khi đang dùng (giữ session) nhưng định
// kỳ 30 ngày từ lần sign-in cuối cùng phải buộc đăng nhập lại để bảo mật.
// Đặt ngoài component để useEffect dependency stable (React hook lint).
const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOGIN_AT_KEY = "auth_login_at";

async function boundedAuthRead<T>(request: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("AUTH_READ_TIMEOUT")), 12_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

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
  const [authDataError, setAuthDataError] = useState<string | null>(null);
  const [failedReadVersion, setFailedReadVersion] = useState(0);
  const profileRequestRef = useRef(0);
  const authEventVersionRef = useRef(0);
  const autoRecoveryRef = useRef(0);

  // Load profile, tenant, branches from Supabase
  const loadUserData = useCallback(
    async (authUser: User) => {
      const request = ++profileRequestRef.current;
      setIsLoading(true);
      setAuthDataError(null);
      setTenant(null);
      setBranches([]);
      setCurrentBranch(null);
      setPermissions(new Set());
      clearProfileCache();
      const timeout = setTimeout(() => {
        if (request !== profileRequestRef.current) return;
        profileRequestRef.current += 1;
        setUser(buildFallbackProfile(authUser));
        setPermissions(new Set());
        setBranches([]);
        setCurrentBranch(null);
        setTenant(null);
        clearProfileCache();
        setAuthDataError("Kiểm tra phiên và quyền truy cập đang mất quá nhiều thời gian. Vui lòng thử lại.");
        setFailedReadVersion(value => value + 1);
        setIsLoading(false);
      }, 12_000);
      try {
        // 1. Profile TRƯỚC — các query khác cần profile.tenant_id + profile.id.
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id,tenant_id,branch_id,role_id,full_name,email,phone,role,is_active,created_at")
          .eq("id", authUser.id)
          .single();

        if (request !== profileRequestRef.current) return;
        if (profileError) throw new Error("Không tải được hồ sơ đăng nhập.");

        if (!profile || !profile.is_active) {
          // Profile not yet created (handle_new_user trigger hasn't fired or failed)
          setUser(buildFallbackProfile(authUser));
          setPermissions(new Set());
          setBranches([]);
          setCurrentBranch(null);
          setTenant(null);
          clearProfileCache();
          return;
        }

        const userProfile: UserProfile = {
          id: profile.id,
          tenantId: profile.tenant_id,
          branchId: profile.branch_id ?? undefined,
          roleId: profile.role_id ?? undefined,
          fullName: profile.full_name,
          email: profile.email ?? "",
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
        // Owner skip permission load (có wildcard "*").
        //
        // CEO 22/05/2026 (Phase 2): dùng getUserEffectivePermissions thay
        // getUserPermissions để bao gồm per-user overrides (grants/revokes).
        // RPC fallback về role permissions nếu user chưa có override.
        const permsPromise: Promise<Set<string>> =
          profile.role === "owner"
            ? Promise.resolve(new Set(["*"]))
            : getUserEffectivePermissions(profile.id)
                .then((codes) => new Set(codes));

        const [tenantRes, branchRes, perms, scopeRes] = await Promise.all([
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
          profile.role === "owner"
            ? Promise.resolve({ data: [], error: null })
            : supabase.rpc("get_user_accessible_branches" as never, { p_user_id: profile.id } as never),
        ]);

        if (request !== profileRequestRef.current) return;

        if (tenantRes.error || branchRes.error || scopeRes.error) {
          throw new Error("Không tải được quyền chi nhánh.");
        }
        const accessibleIds = parseAccessibleBranchIds(scopeRes.data);

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

        const branchData = (branchRes.data ?? []).filter(branch =>
          canViewAllBranches(userProfile.role, perms) || accessibleIds.has(branch.id));
        setBranches([]);
        setCurrentBranch(null);
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

            if (
              storedBranchId === "__all__" &&
              canViewAllBranches(userProfile.role, perms)
            ) {
              // CEO previously selected "Tất cả chi nhánh"
              setCurrentBranch(null);
            } else {
              const currentBr =
                mappedBranches.find((b) => b.id === storedBranchId) ??
                mappedBranches.find((b) => b.id === profile.branch_id) ??
                mappedBranches.find((b) => b.isDefault) ??
                mappedBranches[0];
              setCurrentBranch(currentBr);
              // Lưu init chi nhánh cụ thể để POS fallback (xem note 10/06/2026)
              if (currentBr) {
                try { localStorage.setItem("last_specific_branch_id", currentBr.id); } catch {}
              }
            }
          }
        }
        setAuthDataError(null);
        autoRecoveryRef.current = 0;
      } catch {
        if (request !== profileRequestRef.current) return;
        // If DB queries fail (e.g., tables not created yet), use fallback
        setUser(buildFallbackProfile(authUser));
        setPermissions(new Set());
        setBranches([]);
        setCurrentBranch(null);
        setTenant(null);
        clearProfileCache();
        setAuthDataError("Chưa tải được thông tin đăng nhập và quyền truy cập. Kiểm tra kết nối rồi bấm Thử lại.");
        setFailedReadVersion(value => value + 1);
      } finally {
        clearTimeout(timeout);
        if (request === profileRequestRef.current) setIsLoading(false);
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
    // Session-read failures are recoverable errors, never an empty permission result.
    // Profile/permission reads have their own deadline and keep the gate closed.
    const initTimeoutId = setTimeout(() => {
      if (loadedUserIdRef.current) return;
      setAuthDataError("Chưa xác minh được phiên đăng nhập. Vui lòng thử lại.");
      setIsLoading(false);
    }, 10_000);

    // Sprint LT-6 27/05: Check 30-day HARD timeout TRƯỚC khi getSession.
    // Nếu user đã sign-in trên 30 ngày → force signOut + redirect, không
    // load profile/tenant/branches để tránh waste RTT.
    try {
      const loginAtRaw = localStorage.getItem(LOGIN_AT_KEY);
      const loginAt = loginAtRaw ? Number(loginAtRaw) : 0;
      if (loginAt > 0 && Date.now() - loginAt > MAX_SESSION_AGE_MS) {
        // Hết hạn 30 ngày → clear flag + signOut + redirect.
        localStorage.removeItem(LOGIN_AT_KEY);
        userLogoutRef.current = true; // suppress toast "session expired"
        supabase.auth.signOut().finally(() => {
          clearTimeout(initTimeoutId);
          setIsLoading(false);
          router.replace("/dang-nhap?reason=30d_expired");
        });
        return () => {
          clearTimeout(initTimeoutId);
        };
      }
    } catch {
      // localStorage có thể bị block (private mode) — bỏ qua, fall through.
    }

    // PERF F2: Dùng getSession() thay vì getUser() trên mount.
    // - getSession() đọc session từ cookie/localStorage → INSTANT (0 RTT).
    // - getUser() luôn revalidate qua HTTP với Supabase server (200-400ms VN
    //   mobile). Cold start mỗi page nav phải chờ 1 RTT chỉ để biết "đã login".
    // - onAuthStateChange phía dưới sẽ fire SIGNED_IN nếu session refresh →
    //   loadUserData re-run (nhưng chỉ khi user.id thực sự đổi qua dedup).
    // - Edge case: session expired/tampered → loadUserData query với invalid
    //   token sẽ fail, RLS block → user bị redirect login. Chấp nhận risk
    //   này vì lợi ích 200-400ms perf cho 99% case happy path.
    const bootstrapAuthVersion = authEventVersionRef.current;
    boundedAuthRead(supabase.auth.getSession())
      .then(({ data: { session }, error }) => {
        if (error) throw error;
        const initialUser = session?.user ?? null;
        if (authEventVersionRef.current !== bootstrapAuthVersion
            && loadedUserIdRef.current !== (initialUser?.id ?? null)) {
          clearTimeout(initTimeoutId);
          return;
        }
        if (initialUser) {
          setAuthUser(initialUser);
          wasAuthenticatedRef.current = true;
          // Sprint LT-6 27/05: Seed auth_login_at cho user đã login từ
          // TRƯỚC khi feature 30-day deploy. Không có timestamp → không
          // bao giờ bị check 30 ngày → bypass feature. Fix: seed với
          // Date.now() (existing users có 30 ngày tính từ lần mount đầu
          // sau deploy). Acceptable trade-off vs. force re-login toàn bộ.
          try {
            if (!localStorage.getItem(LOGIN_AT_KEY)) {
              localStorage.setItem(LOGIN_AT_KEY, String(Date.now()));
            }
          } catch {}
          // PERF F13: Race condition fix — onAuthStateChange INITIAL_SESSION
          // có thể fire TRƯỚC getSession.then resolve (Supabase bắn event
          // ngay khi listener register nếu cookie hợp lệ). Trường hợp đó
          // listener đã loadUserData rồi → ở đây skip để tránh fetch profile
          // lần 2.
          if (loadedUserIdRef.current === initialUser.id) {
            // The listener owns the pending read; do not release its loading state.
            clearTimeout(initTimeoutId);
            return;
          }
          loadedUserIdRef.current = initialUser.id;
          loadUserData(initialUser).finally(() => {
            clearTimeout(initTimeoutId);
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
        if (!loadedUserIdRef.current) {
          setAuthDataError("Chưa xác minh được phiên đăng nhập. Vui lòng thử lại.");
          setIsLoading(false);
        }
      });

    // CEO 06/06/2026: bắt "Invalid Refresh Token: Already Used" global.
    //
    // Bug Chrome: refresh_token cũ trong localStorage đã consumed bởi
    // SDK retry trước đó. Supabase SDK loop refresh → 400 "Already Used"
    // → lock contention 5s → init timeout 10s → RPC throw "Chưa đăng nhập"
    // → user thấy trang loading mãi → bấm sidebar không vào được trang.
    //
    // Fix: listen onerror toàn cục, nếu thấy AuthApiError "Already Used"
    // → force clear localStorage sb-* + signOut local + reload /dang-nhap.
    // useEffect ở /dang-nhap (commit 0c67cd9) sẽ xoá localStorage tiếp →
    // SDK init fresh → user login lại OK.
    const handleAlreadyUsedError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const message =
        ("reason" in event && event.reason instanceof Error
          ? event.reason.message
          : "error" in event && event.error instanceof Error
            ? event.error.message
            : "") || "";
      if (
        message.includes("Invalid Refresh Token") ||
        message.includes("Already Used")
      ) {
        try {
          // Clear toàn bộ sb-* trong localStorage + sessionStorage
          const lsKeys: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("sb-")) lsKeys.push(key);
          }
          lsKeys.forEach((k) => localStorage.removeItem(k));
          const ssKeys: string[] = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith("sb-")) ssKeys.push(key);
          }
          ssKeys.forEach((k) => sessionStorage.removeItem(k));
        } catch {
          // ignore
        }
        // Force navigate /dang-nhap để useEffect ở trang đó tiếp tục clean
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/dang-nhap")) {
          window.location.replace("/dang-nhap?redirect=" + encodeURIComponent(window.location.pathname));
        }
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("error", handleAlreadyUsedError);
      window.addEventListener("unhandledrejection", handleAlreadyUsedError);
    }

    // CEO 06/06/2026 — monkey-patch fetch bắt POST 400 tới /auth/v1/token.
    //
    // Reason: SDK Supabase nuốt error response 400 trong internal retry,
    // KHÔNG throw lên Promise rejection → window listener trên không bắt
    // được. F12 CEO mở thấy POST 400 liên tục mà error listener im lặng.
    //
    // Fix: wrap window.fetch, detect URL chứa "/auth/v1/token" + status 400
    // + body có "refresh_token_already_used" hoặc "Invalid Refresh Token"
    // → trigger same cleanup flow.
    let consecutiveAuthFails = 0;
    const FAIL_THRESHOLD = 3;
    const originalFetch = window.fetch;
    const patchedFetch: typeof fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      try {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.toString();
        if (response.status === 400 && url.includes("/auth/v1/token")) {
          consecutiveAuthFails += 1;
          if (consecutiveAuthFails >= FAIL_THRESHOLD) {
            consecutiveAuthFails = 0;
            handleAlreadyUsedError(
              new ErrorEvent("error", {
                message: "Invalid Refresh Token: Already Used",
              }),
            );
          }
        } else if (response.ok && url.includes("/auth/v1/token")) {
          consecutiveAuthFails = 0; // reset khi refresh thành công
        }
      } catch {
        // ignore
      }
      return response;
    };
    if (typeof window !== "undefined") {
      window.fetch = patchedFetch;
    }

    // Subscribe to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      authEventVersionRef.current += 1;
      const sessionUser = session?.user ?? null;
      setAuthUser(sessionUser);

      // Sprint LT-6 27/05: Set/refresh auth_login_at khi SIGNED_IN.
      // KHÔNG set ở TOKEN_REFRESHED / USER_UPDATED vì sẽ reset đồng hồ 30
      // ngày → đồng hồ trượt vô hạn, user không bao giờ bị logout. Chỉ
      // SIGNED_IN (login mới) mới refresh đồng hồ.
      if (event === "SIGNED_IN" && sessionUser) {
        try {
          localStorage.setItem(LOGIN_AT_KEY, String(Date.now()));
        } catch {
          // localStorage block (private mode) — bỏ qua, không block flow.
        }
      }

      if (sessionUser) {
        wasAuthenticatedRef.current = true;
        // DEDUP: chỉ loadUserData khi user.id THỰC SỰ đổi (signin/switch
        // account) hoặc lần đầu (loadedUserIdRef chưa set). TOKEN_REFRESHED
        // / USER_UPDATED không cần re-fetch profile/tenant/branches vì data
        // không đổi — chỉ token đổi.
        if (loadedUserIdRef.current !== sessionUser.id) {
          autoRecoveryRef.current = 0;
          loadedUserIdRef.current = sessionUser.id;
          // loadUserData có try/catch trong body — không throw lên đây.
          loadUserData(sessionUser);
        }
      } else {
        profileRequestRef.current += 1;
        setAuthDataError(null);
        setIsLoading(false);
        autoRecoveryRef.current = 0;
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
          // Sprint LT-6 27/05: TRY REFRESH TRƯỚC khi đá login.
          // Supabase fire SIGNED_OUT trong nhiều case transient:
          //   - Refresh token tạm fail (network blip, DNS hiccup)
          //   - processLock contention multi-tab
          //   - Token rotation race condition
          // Trước đây mọi SIGNED_OUT đều redirect → user bị đá oan.
          // Giờ thử refreshSession() 1 lần — nếu OK → giữ session, không
          // redirect. Nếu refresh thật sự fail → mới đá ra.
          supabase.auth
            .refreshSession()
            .then(({ data, error }) => {
              if (!error && data?.session?.user) {
                // Refresh thành công — Supabase sẽ fire SIGNED_IN event
                // lần nữa → flow trên sẽ restore session. Không redirect.
                wasAuthenticatedRef.current = true;
                return;
              }
              // Refresh thật sự fail → đá ra như cũ.
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("auth:session-expired"));
              }
              try { localStorage.removeItem(LOGIN_AT_KEY); } catch {}
              router.replace("/dang-nhap");
            })
            .catch(() => {
              // refreshSession throw (rất hiếm) → treat như fail.
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("auth:session-expired"));
              }
              try { localStorage.removeItem(LOGIN_AT_KEY); } catch {}
              router.replace("/dang-nhap");
            });
        }
      }
    });

    return () => {
      clearTimeout(initTimeoutId);
      subscription.unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("error", handleAlreadyUsedError);
        window.removeEventListener("unhandledrejection", handleAlreadyUsedError);
        // Restore fetch nếu là instance của ta
        if (window.fetch === patchedFetch) {
          window.fetch = originalFetch;
        }
      }
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

        if (
          branchId === null &&
          !canViewAllBranches(user?.role, permissions)
        ) {
          const fallbackBranch =
            branches.find((branch) => branch.id === user?.branchId) ??
            branches.find((branch) => branch.isDefault) ??
            branches[0];

          if (fallbackBranch) {
            setCurrentBranch(fallbackBranch);
            try {
              localStorage.setItem("active_branch_id", fallbackBranch.id);
              localStorage.setItem("last_specific_branch_id", fallbackBranch.id);
            } catch {
              /* localStorage có thể bị block (private mode) */
            }
          }
          return;
        }

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
              // CEO 10/06/2026 — POS không thể "Tất cả chi nhánh". Lưu thêm
              // chi nhánh CỤ THỂ gần nhất để POS fallback về đó khi user
              // vừa rời trang admin chọn "Tất cả".
              localStorage.setItem("last_specific_branch_id", branchId);
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
    [branches, permissions, user],
  );

  // Derived: branchId for data queries (undefined = no filter = all branches)
  const activeBranchId = currentBranch?.id;

  // Permission check helper
  const hasPermission = useCallback(
    (code: string): boolean => {
      if (isLoading || authDataError || !user?.isActive) return false;
      if (user?.role === "owner") return true;
      if (permissions.has("*")) return true;
      return permissions.has(code);
    },
    [user?.role, user?.isActive, permissions, isLoading, authDataError]
  );

  const logout = useCallback(async () => {
    // Flag để SIGNED_OUT handler biết đây là user-initiated, không show
    // toast "session expired".
    userLogoutRef.current = true;
    // Sprint LT-6 27/05: Clear 30-day session timestamp khi user chủ động
    // logout — tránh case user logout rồi login lại trong 30 ngày bị tính
    // tiếp đồng hồ cũ.
    try { localStorage.removeItem(LOGIN_AT_KEY); } catch {}
    await supabase.auth.signOut();
    router.push("/dang-nhap");
  }, [supabase, router]);

  // Re-fetch profile/tenant/branches. Dùng khi user update /ho-so hoặc khi
  // admin thay đổi role/branch từ trang khác — để UI (header, sidebar, permission)
  // sync ngay không cần reload.
  const refreshProfile = useCallback(async () => {
    autoRecoveryRef.current = 0;
    if (authUser) { await loadUserData(authUser); return; }
    setIsLoading(true);
    setAuthDataError(null);
    try {
      const { data, error } = await boundedAuthRead(supabase.auth.getSession());
      if (error) throw error;
      const sessionUser = data.session?.user;
      if (!sessionUser) {
        setIsLoading(false);
        router.replace("/dang-nhap");
        return;
      }
      setAuthUser(sessionUser);
      loadedUserIdRef.current = sessionUser.id;
      await loadUserData(sessionUser);
    } catch {
      setAuthDataError("Chưa xác minh được phiên đăng nhập. Vui lòng thử lại.");
      setIsLoading(false);
    }
  }, [authUser, loadUserData, router, supabase]);

  // Retry failed bootstrap reads only; preserve session/draft storage and require real permissions.
  useEffect(() => {
    if (!authDataError || !authUser) return;
    let started = false;
    const retry = () => {
      if (started || autoRecoveryRef.current >= 2 || navigator.onLine === false) return;
      started = true;
      autoRecoveryRef.current += 1;
      void loadUserData(authUser);
    };
    const onOnline = () => { autoRecoveryRef.current = 0; retry(); };
    const timer = setTimeout(retry, 1500 * (autoRecoveryRef.current + 1));
    window.addEventListener("online", onOnline);
    return () => { clearTimeout(timer); window.removeEventListener("online", onOnline); };
  }, [authDataError, authUser, loadUserData, failedReadVersion]);

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
        authDataError,
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

/**
 * Sprint A.4 (CEO 12/05): fallback khi DB query fail / chưa có profile row.
 * Trước đây gán `role: "owner" + isActive: true` → DB fail = user thoáng
 * có quyền owner → bypass permission gate. Privilege escalation risk.
 *
 * Sửa: role thấp nhất ("staff") + isActive=false. UI thấy isActive=false
 * → block thao tác cho tới khi profile load thật. usePermissions() trả
 * permissions=empty → mọi hasPermission() return false (trừ chính owner
 * thật được verified qua DB query).
 */
function buildFallbackProfile(authUser: User): UserProfile {
  const meta = authUser.user_metadata ?? {};
  const authEmail = isInternalAuthEmail(authUser.email) ? "" : (authUser.email ?? "");
  return {
    id: authUser.id,
    tenantId: "",
    fullName: meta.full_name ?? (authEmail ? authEmail.split("@")[0] : "User"),
    email: authEmail,
    phone: meta.phone ?? undefined,
    role: "staff",
    isActive: false,
    createdAt: authUser.created_at,
  };
}
