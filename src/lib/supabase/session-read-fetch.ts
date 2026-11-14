const protectedReadRpcs = new Set([
  "pending_manager_approvals_00566",
  "fnb_pending_cancel_requests_00455",
  "fnb_print_state_v1",
  "fnb_print_jobs_status_v1",
]);

const sessionRequired = () => new Response(
  JSON.stringify({ code: "PGRST301", message: "Chưa xác thực được phiên đăng nhập." }),
  { status: 401, headers: { "Content-Type": "application/json" } },
);

/** Guard only these reads at the point where Supabase has selected the bearer. */
export function createSessionReadFetch(
  supabaseUrl: string,
  publicKey: string,
  send: typeof fetch,
  recover: (rejectedToken: string) => Promise<void>,
  isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false,
): typeof fetch {
  const base = new URL("/rest/v1/", supabaseUrl);
  const rejectedTokens = new Set<string>();
  let recovery: Promise<void> | undefined;
  let recoveryAttempted = false;

  const recoverOnce = (token: string) => {
    if (recovery || recoveryAttempted || !isOnline()) return;
    recoveryAttempted = true;
    recovery = Promise.resolve().then(() => recover(token)).catch(() => {
      // SDK auto refresh remains responsible for retrying transient failures.
    }).finally(() => { recovery = undefined; });
  };

  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input), base);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const path = url.pathname.slice(base.pathname.length);
    const protectedRead = url.origin === base.origin && url.pathname.startsWith(base.pathname) &&
      ((path === "notifications" && (method === "GET" || method === "HEAD")) ||
       (method === "POST" && path.startsWith("rpc/") && protectedReadRpcs.has(path.slice(4))));
    if (!protectedRead) return send(input, init);

    const headers = new Headers(init?.headers ?? request?.headers);
    const token = /^Bearer (.+)$/i.exec(headers.get("authorization") ?? "")?.[1];
    if (!token || token === publicKey) return sessionRequired();
    if (rejectedTokens.has(token)) {
      recoverOnce(token);
      return sessionRequired();
    }
    if (!isOnline()) throw new TypeError("Thiết bị đang mất mạng.");

    const response = await send(input, init);
    if (response.status === 401) {
      rejectedTokens.add(token);
      if (rejectedTokens.size > 4) {
        const oldest = rejectedTokens.values().next().value;
        if (oldest) rejectedTokens.delete(oldest);
      }
      recoverOnce(token);
    } else if (response.ok && !rejectedTokens.has(token) && !recovery) {
      recoveryAttempted = false;
    }
    return response;
  };
}
