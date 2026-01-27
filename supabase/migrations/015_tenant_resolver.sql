-- OneBiz ERP - Tenant resolver for whitelabel UI
-- Exposes limited tenant info via RPC callable by anon.

create or replace function public.resolve_tenant(p_hostname text)
returns table (
  id uuid,
  name text,
  logo_url text,
  primary_color text,
  features jsonb,
  settings jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  host text;
  alt_host text;
begin
  host := lower(coalesce(p_hostname, ''));
  if host = '' then
    return;
  end if;

  -- 1) Exact match
  return query
  select t.id, t.name, t.logo_url, t.primary_color, t.features, t.settings
  from public.tenants t
  where lower(t.custom_domain) = host
  limit 1;

  if found then
    return;
  end if;

  -- 2) Strip first label (module subdomain) and try again
  -- Example: hr.onebiz.com.vn -> onebiz.com.vn
  if position('.' in host) > 0 then
    alt_host := substring(host from position('.' in host) + 1);
    return query
    select t.id, t.name, t.logo_url, t.primary_color, t.features, t.settings
    from public.tenants t
    where lower(t.custom_domain) = alt_host
    limit 1;
  end if;
end;
$$;

grant execute on function public.resolve_tenant(text) to anon;
grant execute on function public.resolve_tenant(text) to authenticated;
