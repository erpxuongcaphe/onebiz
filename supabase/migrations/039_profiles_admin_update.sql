-- OneBiz ERP - Allow role admins to update profiles within tenant

create policy "profiles: update within tenant by admin"
on public.profiles
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('roles.*')
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('roles.*')
);
