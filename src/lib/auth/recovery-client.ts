import { createClient } from "@supabase/supabase-js";

/** Recovery credentials stay in memory. Never overwrite the signed-in POS cookies. */
export function createRecoveryClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "onebiz-recovery-isolated" } },
  );
}
