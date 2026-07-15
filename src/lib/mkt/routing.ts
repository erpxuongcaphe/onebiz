export type MktBasePath = "" | "/mkt";

export function isMktSubdomainHost(host: string | null): boolean {
  const hostname = (host ?? "").split(":", 1)[0].toLowerCase();
  return hostname.startsWith("mkthub.") || hostname.startsWith("mkthub-");
}

export function resolveMktHref(href: string, basePath: MktBasePath): string {
  if (href !== "/mkt" && !href.startsWith("/mkt/")) return href;
  if (basePath === "/mkt") return href;
  return href.slice("/mkt".length) || "/";
}
