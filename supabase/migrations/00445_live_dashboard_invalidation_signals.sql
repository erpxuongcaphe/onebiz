-- Send only invalidation metadata, not financial row contents.
-- Existing invoice/cash RLS and business records are not modified.
begin;
set local lock_timeout = '1s';
create table if not exists public.dashboard_live_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid,
  created_at timestamptz not null default now()
);
alter table public.dashboard_live_signals enable row level security;
revoke all on public.dashboard_live_signals from public, anon, authenticated;
grant select on public.dashboard_live_signals to authenticated;
do $policy$ begin
if not exists(select 1 from pg_policies where schemaname='public' and tablename='dashboard_live_signals' and policyname='dashboard_live_signals_read') then
create policy dashboard_live_signals_read on public.dashboard_live_signals for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.tenant_id=dashboard_live_signals.tenant_id and p.is_active)
  and public.user_has_permission(auth.uid(), 'reports.dashboard')
  and (public.user_has_branch_access(auth.uid(), branch_id)
       or (branch_id is null and public.user_has_permission(auth.uid(), 'reports.view_all_branches')))
);
end if; end; $policy$;
create or replace function public.emit_dashboard_live_signal_00445()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_row jsonb; v_old jsonb;
begin
  v_row := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if v_row->>'tenant_id' is not null then
    insert into public.dashboard_live_signals(tenant_id, branch_id)
    values ((v_row->>'tenant_id')::uuid, nullif(v_row->>'branch_id','')::uuid);
  end if;
  if tg_op='UPDATE' then
    v_old := to_jsonb(old);
    if (v_old->>'tenant_id', v_old->>'branch_id') is distinct from (v_row->>'tenant_id', v_row->>'branch_id') and v_old->>'tenant_id' is not null then
      insert into public.dashboard_live_signals(tenant_id, branch_id)
      values ((v_old->>'tenant_id')::uuid, nullif(v_old->>'branch_id','')::uuid);
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.emit_dashboard_live_signal_00445() from public, anon, authenticated;
do $triggers$ begin
  if not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='dashboard_live_invoice_00445' and not tgisinternal) then
    create trigger dashboard_live_invoice_00445 after insert or update or delete on public.invoices for each row execute function public.emit_dashboard_live_signal_00445();
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.cash_transactions'::regclass and tgname='dashboard_live_cash_00445' and not tgisinternal) then
    create trigger dashboard_live_cash_00445 after insert or update or delete on public.cash_transactions for each row execute function public.emit_dashboard_live_signal_00445();
  end if;
end; $triggers$;
do $$
begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then raise exception 'LIVE_DASHBOARD_PUBLICATION_MISSING'; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dashboard_live_signals') then
    alter publication supabase_realtime add table public.dashboard_live_signals;
  end if;
end;
$$;
commit;
