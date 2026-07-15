import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMktContext } from "@/lib/mkt/read-models";
import type { MktContext } from "@/lib/mkt/context";

/**
 * Shared by the MKT layout and page during one Server Component request.
 * React cache is request-scoped, so auth and permission checks are not
 * repeated while navigating a single MKT route.
 */
export const getMktRequestContext = cache(async () => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

  if (error || !userId) {
    return {
      supabase,
      signedIn: false,
      userId: null,
      ctx: { canView: false } as MktContext,
    };
  }

  return {
    supabase,
    signedIn: true,
    userId,
    ctx: await getMktContext(supabase),
  };
});
