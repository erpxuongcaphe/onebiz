export function isOperationsHubHost(host: string | null): boolean {
  return ["hub.onebiz.com.vn", "hub.localhost"].includes(
    (host ?? "").split(":")[0].toLowerCase(),
  );
}
