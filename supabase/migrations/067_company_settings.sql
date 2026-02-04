-- OneBiz ERP — Update company / tenant settings
-- Stores name + {tax_code, address, phone} into the existing tenants row.
-- Permission-guarded: requires settings.company.update

create or replace function public.update_company_settings(
  p_name    text,
  p_tax_code text,
  p_address  text,
  p_phone    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
begin
  -- permission gate
  if not public.has_permission('settings.company.update') then
    raise exception 'Permission denied';
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  update public.tenants
  set
    name       = coalesce(nullif(trim(p_name), ''), name),   -- keep old name if blank
    settings   = settings
                 || jsonb_build_object(
                      'tax_code', coalesce(p_tax_code, ''),
                      'address',  coalesce(p_address,  ''),
                      'phone',    coalesce(p_phone,    '')
                    ),
    updated_at = now()
  where id = t_id;
end;
$$;

grant execute on function public.update_company_settings(text, text, text, text) to authenticated;
