import { supabase } from './supabaseClient';

export type TenantInfo = {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  features: any;
  settings: any;
};

export async function resolveTenantByHostname(hostname: string): Promise<TenantInfo | null> {
  if (!supabase) return null;
  const h = (hostname || '').trim().toLowerCase();
  if (!h) return null;

  const { data, error } = await supabase
    .rpc('resolve_tenant', { p_hostname: h })
    .maybeSingle();

  if (error) return null;
  if (!data) return null;
  return data as TenantInfo;
}
