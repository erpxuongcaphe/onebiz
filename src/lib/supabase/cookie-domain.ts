const SHARED_COOKIE_ROOT = "onebiz.com.vn";

export function getSharedCookieDomain(hostHeader: string | null | undefined): string | undefined {
  const hostname = (hostHeader ?? "").split(":")[0]?.toLowerCase();
  if (!hostname) return undefined;

  if (hostname === SHARED_COOKIE_ROOT || hostname.endsWith(`.${SHARED_COOKIE_ROOT}`)) {
    return `.${SHARED_COOKIE_ROOT}`;
  }

  return undefined;
}
