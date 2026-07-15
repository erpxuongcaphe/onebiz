import { cache } from "react";
import { headers } from "next/headers";
import { isMktSubdomainHost, type MktBasePath } from "@/lib/mkt/routing";

export const getMktBasePath = cache(async (): Promise<MktBasePath> => {
  const requestHeaders = await headers();
  return isMktSubdomainHost(requestHeaders.get("host")) ? "" : "/mkt";
});
