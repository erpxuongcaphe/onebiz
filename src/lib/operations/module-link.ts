import { isOperationsHubHost } from "./routing";
import { isMktSubdomainHost } from "@/lib/mkt/routing";
export function operationsModuleLink(
  module: "hub" | "mkt",
  query: string,
  host = "",
  protocol = "https:",
): string {
  const hub = isOperationsHubHost(host),
    mkt = isMktSubdomainHost(host);
  const path = module === "hub" ? "/hub" : "/mkt/tasks";
  if ((hub && module === "mkt") || (mkt && module === "hub")) {
    const local = host.split(":")[0].endsWith(".localhost");
    const port = host.includes(":") ? `:${host.split(":")[1]}` : "";
    const target = module === "hub" ? "hub" : "mkthub";
    return `${local ? protocol : "https:"}//${target}.${local ? "localhost" : "onebiz.com.vn"}${local ? port : ""}${module === "hub" ? "/" : "/tasks"}?${query}`;
  }
  return `${module === "hub" && hub ? "/" : module === "mkt" && mkt ? "/tasks" : path}?${query}`;
}
