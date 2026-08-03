
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
// CEO 22/05/2026 (Phase 2): per-user permission overrides
import { getUserEffectivePermissions } from "@/lib/services/supabase/permission-overrides";
import { _seedProfileCache as seedProfileCache, _clearProfileCache as clearProfileCache } from "@/lib/services/supabase/base";
import { readDeviceBinding } from "@/lib/hooks/use-device-binding";
import { isInternalAuthEmail } from "@/lib/auth/user-identifiers";
import { PERMISSIONS } from "@/lib/permissions/constants";

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
  /** Switch to a specific branch, or null = "Táº¥t cáº£ chi nhÃ¡nh" (CEO view) */
  switchBranch: (branchId: string | null) => void;
  /** Branch ID to filter data queries â€” undefined means show all branches */
  activeBranchId: string | undefined;
  /** Check if current user has a specific permission */
  hasPermission: (code: string) => boolean;
  /** Re-fetch profile + tenant + branches. DÃ¹ng sau khi user update /ho-so. */
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
}

// --- Context ---

const AuthContext = createContext<AuthContextValue | null>(null);

// Sprint LT-6 (CEO 27/05/2026): 30-day HARD session timeout.
// CEO yÃªu cáº§u user khÃ´ng bá»‹ Ä‘Ã¡ khi Ä‘ang dÃ¹ng (giá»¯ session) nhÆ°ng Ä‘á»‹nh
// ká»³ 30 ngÃ y tá»« láº§n sign-in cuá»‘i cÃ¹ng pháº£i buá»™c Ä‘Äƒng nháº­p láº¡i Ä‘á»ƒ báº£o máº­t.
// Äáº·t ngoÃ i component Ä‘á»ƒ useEffect dependency stable (React hook lint).
const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOGIN_AT_KEY = "auth_login_at";

function canViewAllBranches(
  role: UserProfile["role"] | undefined,
  permissionCodes: Set<string>,
): boolean {
  return (
    role === "owner" ||
    permissionCodes.has("*") ||
    permissionCodes.has(PERMISSIONS.REPORTS_VIEW_ALL_BRANCHES) ||
    permissionCodes.has(PERMISSIONS.SYSTEM_MANAGE_BRANCHES)
  );
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

  // Load profile, tenant, branches from Supabase
  const loadUserData = useCallback(
    async (authUser: User) => {
      try {
        // 1. Profile TRÆ¯á»šC â€” cÃ¡c query khÃ¡c cáº§n profile.tenant_id + profile.id.
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
          email: profile.email ?? "",
          phone: profile.phone ?? undefined,
          role: profile.role,
          isActive: profile.is_active,
          createdAt: profile.created_at,
        };
        setUser(userProfile);

        // PERF F11: Seed profile cache trong base.ts Ä‘á»ƒ service layer KHÃ”NG
        // refetch profile láº§n ná»¯a. TrÆ°á»›c Ä‘Ã¢y AuthContext fetch profile (1) rá»“i
        // service Ä‘áº§u tiÃªn gá»i getCurrentTenantId() â†’ fetch profile (2).
        // Giá» chia sáº» ngay â†’ giáº£m 1 RTT/page nav.
        seedProfileCache({
          tenantId: profile.tenant_id,
          branchId: profile.branch_id ?? null,
          userId: profile.id,
        });

        // 2-4. Song song hoÃ¡ tenant + branches + permissions â€” trÆ°á»›c Ä‘Ã¢y 3 call
        // tuáº§n tá»± lÃ m cold start 1.5-2s, blocking toÃ n bá»™ AuthProvider render.
        // Owner skip permission load (cÃ³ wildcard "*").
        //
        // CEO 22/05/2026 (Phase 2): dÃ¹ng getUserEffectivePermissions thay
        // getUserPermissions Ä‘á»ƒ bao gá»“m per-user overrides (grants/revokes).
        // RPC fallback vá» role permissions náº¿u user chÆ°a cÃ³ override.
        const permsPromise: Promise<Set<string>> =
          profile.role === "owner"
            ? Promise.resolve(new Set(["*"]))
            : getUserEffectivePermissions(profile.id)
                .then((codes) => new Set(codes))
                .catch(async () => {
                  // Fallback: RPC fail â†’ dÃ¹ng role permissions thuáº§n
                  return getUserPermissions(profile.id).catch(
                    () => new Set<string>(),
                  );
                });

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
            // Fallback "store" cho chi nhÃ¡nh cÅ© chÆ°a set branch_type (backward compat).
            branchType: (b.branch_type ?? "store") as Branch["branchType"],
            code: b.code ?? undefined,
            address: b.address ?? undefined,
            phone: b.phone ?? undefined,
            isDefault: b.is_default,
            createdAt: b.created_at,
          }));
          setBranches(mappedBranches);

          // Device binding: náº¿u admin Ä‘Ã£ bind tablet nÃ y vÃ o 1 chi nhÃ¡nh cá»‘
          // Ä‘á»‹nh â†’ force currentBranch vá» branch Ä‘Ã³, bá» qua localStorage +
          // profile.branch_id. Chá»‰ náº¿u branch Ä‘Ã£ bind váº«n tá»“n táº¡i trong tenant
          // (trÃ¡nh tablet zombie trá» tá»›i branch Ä‘Ã£ xoÃ¡).
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
              // CEO previously selected "Táº¥t cáº£ chi nhÃ¡nh"
              setCurrentBranch(null);
            } else {
              const currentBr =
                mappedBranches.find((b) => b.id === storedBranchId) ??
                mappedBranches.find((b) => b.id === profile.branch_id) ??
                mappedBranches.find((b) => b.isDefault) ??
                mappedBranches[0];
              setCurrentBranch(currentBr);
              // LÆ°u init chi nhÃ¡nh cá»¥ thá»ƒ Ä‘á»ƒ POS fallback (xem note 10/06/2026)
              if (currentBr) {
                try { localStorage.setItem("last_specific_branch_id", currentBr.id); } catch {}
              }
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
  // Flag set by explicit logout() to suppress "session expired" toast â€”
  // user-initiated logout shouldn't show a warning.
  const userLogoutRef = useRef(false);
  // Track which user.id Ä‘Ã£ loadUserData rá»“i Ä‘á»ƒ dedup. onAuthStateChange fire
  // má»—i 50 phÃºt (TOKEN_REFRESHED) + INITIAL_SESSION + USER_UPDATED â€” náº¿u
  // má»—i event Ä‘á»u fire loadUserData() â†’ 5-17 láº§n fetch profile/tenant/branches
  // â†’ cross-tab lock contention â†’ "Lock broken by another request with the
  // 'steal' option" â†’ toÃ n bá»™ services downstream throw.
  // Fix: chá»‰ load láº¡i khi user.id THá»°C Sá»° Ä‘á»•i (signin/switch account).
  const loadedUserIdRef = useRef<string | null>(null);

  // Listen to Supabase auth state changes
  useEffect(() => {
    // Safety net: náº¿u getUser() hang 10s (network dropped, DNS fail, CORS),
    // force release spinner Ä‘á»ƒ user khÃ´ng tháº¥y mÃ n hÃ¬nh tráº¯ng vÃ´ háº¡n. TrÆ°á»›c
    // Ä‘Ã¢y getUser() thiáº¿u .catch() â†’ isLoading stuck forever â†’ cáº£ app render
    // null qua PermissionPage â†’ CEO bÃ¡o "web quay vÃ²ng".
    const initTimeoutId = setTimeout(() => {
      setIsLoading((current) => {
        if (current) {
          console.warn("[AuthProvider] Init timeout 10s â€” force release spinner");
        }
        return false;
      });
    }, 10_000);

    // Sprint LT-6 27/05: Check 30-day HARD timeout TRÆ¯á»šC khi getSession.
    // Náº¿u user Ä‘Ã£ sign-in trÃªn 30 ngÃ y â†’ force signOut + redirect, khÃ´ng
    // load profile/tenant/branches Ä‘á»ƒ trÃ¡nh waste RTT.
    try {
      const loginAtRaw = localStorage.getItem(LOGIN_AT_KEY);
      const loginAt = loginAtRaw ? Number(loginAtRaw) : 0;
      if (loginAt > 0 && Date.now() - loginAt > MAX_SESSION_AGE_MS) {
        // Háº¿t háº¡n 30 ngÃ y â†’ clear flag + signOut + redirect.
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
      // localStorage cÃ³ thá»ƒ bá»‹ block (private mode) â€” bá» qua, fall through.
    }

    // PERF F2: DÃ¹ng getSession() thay vÃ¬ getUser() trÃªn mount.
    // - getSession() Ä‘á»c session tá»« cookie/localStorage â†’ INSTANT (0 RTT).
    // - getUser() luÃ´n revalidate qua HTTP vá»›i Supabase server (200-400ms VN
    //   mobile). Cold start má»—i page nav pháº£i chá» 1 RTT chá»‰ Ä‘á»ƒ biáº¿t "Ä‘Ã£ login".
    // - onAuthStateChange phÃ­a dÆ°á»›i sáº½ fire SIGNED_IN náº¿u session refresh â†’
    //   loadUserData re-run (nhÆ°ng chá»‰ khi user.id thá»±c sá»± Ä‘á»•i qua dedup).
    // - Edge case: session expired/tampered â†’ loadUserData query vá»›i invalid
    //   token sáº½ fail, RLS block â†’ user bá»‹ redirect login. Cháº¥p nháº­n risk
    //   nÃ y vÃ¬ lá»£i Ã­ch 200-400ms perf cho 99% case happy path.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        const initialUser = session?.user ?? null;
        if (initialUser) {
          setAuthUser(initialUser);
          wasAuthenticatedRef.current = true;
          // Sprint LT-6 27/05: Seed auth_login_at cho user Ä‘Ã£ login tá»«
          // TRÆ¯á»šC khi feature 30-day deploy. KhÃ´ng cÃ³ timestamp â†’ khÃ´ng
          // bao giá» bá»‹ check 30 ngÃ y â†’ bypass feature. Fix: seed vá»›i
          // Date.now() (existing users cÃ³ 30 ngÃ y tÃ­nh tá»« láº§n mount Ä‘áº§u
          // sau deploy). Acceptable trade-off vs. force re-login toÃ n bá»™.
          try {
            if (!localStorage.getItem(LOGIN_AT_KEY)) {
              localStorage.setItem(LOGIN_AT_KEY, String(Date.now()));
            }
          } catch {}
          // PERF F13: Race condition fix â€” onAuthStateChange INITIAL_SESSION
          // cÃ³ thá»ƒ fire TRÆ¯á»šC getSession.then resolve (Supabase báº¯n event
          // ngay khi listener register náº¿u cookie há»£p lá»‡). TrÆ°á»ng há»£p Ä‘Ã³
          // listener Ä‘Ã£ loadUserData rá»“i â†’ á»Ÿ Ä‘Ã¢y skip Ä‘á»ƒ trÃ¡nh fetch profile
          // láº§n 2.
          if (loadedUserIdRef.current === initialUser.id) {
            // ÄÃ£ load qua listener â€” chá»‰ release spinner.
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
        // Network fail, token invalid, CORS, DNS â€” treat nhÆ° unauthenticated
        // thay vÃ¬ Ä‘á»ƒ isLoading stuck true.
        console.error("[AuthProvider] getSession failed:", err);
        clearTimeout(initTimeoutId);
        setIsLoading(false);
      });

    // CEO 06/06/2026: báº¯t "Invalid Refresh Token: Already Used" global.
    //
    // Bug Chrome: refresh_token cÅ© trong localStorage Ä‘Ã£ consumed bá»Ÿi
    // SDK retry trÆ°á»›c Ä‘Ã³. Supabase SDK loop refresh â†’ 400 "Already Used"
    // â†’ lock contention 5s â†’ init timeout 10s â†’ RPC throw "ChÆ°a Ä‘Äƒng nháº­p"
    // â†’ user tháº¥y trang loading mÃ£i â†’ báº¥m sidebar khÃ´ng vÃ o Ä‘Æ°á»£c trang.
    //
    // Fix: listen onerror toÃ n cá»¥c, náº¿u tháº¥y AuthApiError "Already Used"
    // â†’ force clear localStorage sb-* + signOut local + reload /dang-nhap.
    // useEffect á»Ÿ /dang-nhap (commit 0c67cd9) sáº½ xoÃ¡ localStorage tiáº¿p â†’
    // SDK init fresh â†’ user login láº¡i OK.
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
          // Clear toÃ n bá»™ sb-* trong localStorage + sessionStorage
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
        // Force navigate /dang-nhap Ä‘á»ƒ useEffect á»Ÿ trang Ä‘Ã³ tiáº¿p tá»¥c clean
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/dang-nhap")) {
          window.location.replace("/dang-nhap?redirect=" + encodeURIComponent(window.location.pathname));
        }
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("error", handleAlreadyUsedError);
      window.addEventListener("unhandledrejection", handleAlreadyUsedError);
    }

    // CEO 06/06/2026 â€” monkey-patch fetch báº¯t POST 400 tá»›i /auth/v1/token.
    //
    // Reason: SDK Supabase nuá»‘t error response 400 trong internal retry,
    // KHÃ”NG throw lÃªn Promise rejection â†’ window listener trÃªn khÃ´ng báº¯t
    // Ä‘Æ°á»£c. F12 CEO má»Ÿ tháº¥y POST 400 liÃªn tá»¥c mÃ  error listener im láº·ng.
    //
    // Fix: wrap window.fetch, detect URL chá»©a "/auth/v1/token" + status 400
    // + body cÃ³ "refresh_token_already_used" hoáº·c "Invalid Refresh Token"
    // â†’ trigger same cleanup flow.
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
          consecutiveAuthFails = 0; // reset khi refresh thÃ nh cÃ´ng
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
      const sessionUser = session?.user ?? null;
      setAuthUser(sessionUser);

      // Sprint LT-6 27/05: Set/refresh auth_login_at khi SIGNED_IN.
      // KHÃ”NG set á»Ÿ TOKEN_REFRESHED / USER_UPDATED vÃ¬ sáº½ reset Ä‘á»“ng há»“ 30
      // ngÃ y â†’ Ä‘á»“ng há»“ trÆ°á»£t vÃ´ háº¡n, user khÃ´ng bao giá» bá»‹ logout. Chá»‰
      // SIGNED_IN (login má»›i) má»›i refresh Ä‘á»“ng há»“.
      if (event === "SIGNED_IN" && sessionUser) {
        try {
          localStorage.setItem(LOGIN_AT_KEY, String(Date.now()));
        } catch {
          // localStorage block (private mode) â€” bá» qua, khÃ´ng block flow.
        }
      }

      if (sessionUser) {
        wasAuthenticatedRef.current = true;
        // DEDUP: chá»‰ loadUserData khi user.id THá»°C Sá»° Ä‘á»•i (signin/switch
        // account) hoáº·c láº§n Ä‘áº§u (loadedUserIdRef chÆ°a set). TOKEN_REFRESHED
        // / USER_UPDATED khÃ´ng cáº§n re-fetch profile/tenant/branches vÃ¬ data
        // khÃ´ng Ä‘á»•i â€” chá»‰ token Ä‘á»•i.
        if (loadedUserIdRef.current !== sessionUser.id) {
          loadedUserIdRef.current = sessionUser.id;
          // loadUserData cÃ³ try/catch trong body â€” khÃ´ng throw lÃªn Ä‘Ã¢y.
          loadUserData(sessionUser);
        }
      } else {
        setUser(null);
        setTenant(null);
        setBranches([]);
        setCurrentBranch(null);
        setPermissions(new Set());
        // Reset dedup ref Ä‘á»ƒ láº§n sign-in tiáº¿p theo sáº½ load láº¡i
        loadedUserIdRef.current = null;
        // PERF F11: Clear profile cache trong base.ts Ä‘á»ƒ service khÃ´ng tráº£
        // tenant cÅ© cho user má»›i (náº¿u admin switch account).
        clearProfileCache();

        // Náº¿u trÆ°á»›c Ä‘Ã³ Ä‘Ã£ Ä‘Äƒng nháº­p vÃ  bÃ¢y giá» session máº¥t (token háº¿t háº¡n,
        // refresh fail, logout tá»« device khÃ¡c) â†’ notify + redirect. Bá» qua
        // case logout chá»§ Ä‘á»™ng (Ä‘Ã£ redirect tá»« logout() rá»“i).
        const wasAuthenticated = wasAuthenticatedRef.current;
        const userInitiated = userLogoutRef.current;
        wasAuthenticatedRef.current = false;
        userLogoutRef.current = false;

        if (wasAuthenticated && !userInitiated && event === "SIGNED_OUT") {
          // Sprint LT-6 27/05: TRY REFRESH TRÆ¯á»šC khi Ä‘Ã¡ login.
          // Supabase fire SIGNED_OUT trong nhiá»u case transient:
          //   - Refresh token táº¡m fail (network blip, DNS hiccup)
          //   - processLock contention multi-tab
          //   - Token rotation race condition
          // TrÆ°á»›c Ä‘Ã¢y má»i SIGNED_OUT Ä‘á»u redirect â†’ user bá»‹ Ä‘Ã¡ oan.
          // Giá» thá»­ refreshSession() 1 láº§n â€” náº¿u OK â†’ giá»¯ session, khÃ´ng
          // redirect. Náº¿u refresh tháº­t sá»± fail â†’ má»›i Ä‘Ã¡ ra.
          supabase.auth
            .refreshSession()
            .then(({ data, error }) => {
              if (!error && data?.session?.user) {
                // Refresh thÃ nh cÃ´ng â€” Supabase sáº½ fire SIGNED_IN event
                // láº§n ná»¯a â†’ flow trÃªn sáº½ restore session. KhÃ´ng redirect.
                wasAuthenticatedRef.current = true;
                return;
              }
              // Refresh tháº­t sá»± fail â†’ Ä‘Ã¡ ra nhÆ° cÅ©.
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("auth:session-expired"));
              }
              try { localStorage.removeItem(LOGIN_AT_KEY); } catch {}
              router.replace("/dang-nhap");
            })
            .catch(() => {
              // refreshSession throw (ráº¥t hiáº¿m) â†’ treat nhÆ° fail.
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
        // Restore fetch náº¿u lÃ  instance cá»§a ta
        if (window.fetch === patchedFetch) {
          window.fetch = originalFetch;
        }
      }
    };
  }, [supabase, loadUserData, router]);

  const switchBranch = useCallback(
    (branchId: string | null) => {
      // Defensive try/catch â€” switchBranch fire trong sync click handler.
      // Náº¿u throw Ä‘á»“ng bá»™ (vd: localStorage.setItem fail vÃ¬ quota), error
      // bubble lÃªn error.tsx â†’ root crash. Log + swallow Ä‘á»ƒ UI tiáº¿p tá»¥c.
      try {
        // Device binding hard-stop â€” tablet Ä‘Ã£ khoÃ¡ vÃ o chi nhÃ¡nh cá»¥ thá»ƒ,
        // khÃ´ng cho Ä‘á»•i. Staff báº¥m dropdown cÅ©ng silent no-op (UI Ä‘Ã£ lock).
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
              /* localStorage cÃ³ thá»ƒ bá»‹ block (private mode) */
            }
          }
          return;
        }

        if (branchId === null) {
          // "Táº¥t cáº£ chi nhÃ¡nh" â€” CEO view
          setCurrentBranch(null);
          try {
            localStorage.setItem("active_branch_id", "__all__");
          } catch {
            /* localStorage cÃ³ thá»ƒ bá»‹ block (private mode) */
          }
        } else {
          const branch = branches.find((b) => b.id === branchId);
          if (branch) {
            setCurrentBranch(branch);
            try {
              localStorage.setItem("active_branch_id", branchId);
              // CEO 10/06/2026 â€” POS khÃ´ng thá»ƒ "Táº¥t cáº£ chi nhÃ¡nh". LÆ°u thÃªm
              // chi nhÃ¡nh Cá»¤ THá»‚ gáº§n nháº¥t Ä‘á»ƒ POS fallback vá» Ä‘Ã³ khi user
              // vá»«a rá»i trang admin chá»n "Táº¥t cáº£".
              localStorage.setItem("last_specific_branch_id", branchId);
            } catch {
              /* idem */
            }
          } else {
            console.warn(
              `[switchBranch] KhÃ´ng tÃ¬m tháº¥y branch id="${branchId}" trong list ${branches.length} branches.`,
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
      if (user?.role === "owner") return true;
      if (permissions.has("*")) return true;
      return permissions.has(code);
    },
    [user?.role, permissions]
  );

  const logout = useCallback(async () => {
    // Flag Ä‘á»ƒ SIGNED_OUT handler biáº¿t Ä‘Ã¢y lÃ  user-initiated, khÃ´ng show
    // toast "session expired".
    userLogoutRef.current = true;
    // Sprint LT-6 27/05: Clear 30-day session timestamp khi user chá»§ Ä‘á»™ng
    // logout â€” trÃ¡nh case user logout rá»“i login láº¡i trong 30 ngÃ y bá»‹ tÃ­nh
    // tiáº¿p Ä‘á»“ng há»“ cÅ©.
    try { localStorage.removeItem(LOGIN_AT_KEY); } catch {}
    await supabase.auth.signOut();
    router.push("/dang-nhap");
  }, [supabase, router]);

  // Re-fetch profile/tenant/branches. DÃ¹ng khi user update /ho-so hoáº·c khi
  // admin thay Ä‘á»•i role/branch tá»« trang khÃ¡c â€” Ä‘á»ƒ UI (header, sidebar, permission)
  // sync ngay khÃ´ng cáº§n reload.
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

/**
 * Sprint A.4 (CEO 12/05): fallback khi DB query fail / chÆ°a cÃ³ profile row.
 * TrÆ°á»›c Ä‘Ã¢y gÃ¡n `role: "owner" + isActive: true` â†’ DB fail = user thoÃ¡ng
 * cÃ³ quyá»n owner â†’ bypass permission gate. Privilege escalation risk.
 *
 * Sá»­a: role tháº¥p nháº¥t ("staff") + isActive=false. UI tháº¥y isActive=false
 * â†’ block thao tÃ¡c cho tá»›i khi profile load tháº­t. usePermissions() tráº£
 * permissions=empty â†’ má»i hasPermission() return false (trá»« chÃ­nh owner
 * tháº­t Ä‘Æ°á»£c verified qua DB query).
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

