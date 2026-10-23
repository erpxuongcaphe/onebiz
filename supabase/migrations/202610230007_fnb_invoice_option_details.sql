-- Read-only stock reconciliation follows existing branch-document access.
-- New checkouts snapshot choices; historical invoices are never rewritten.
begin;
set local lock_timeout='3s';
do $patch$
declare target regprocedure; d text; old_guard text:='public.user_has_permission(actor,''invoices.view'') or public.user_has_permission(actor,''pos_fnb.view_orders'')';
 new_guard text:='public.user_has_permission(actor,''invoices.view'') or public.user_has_permission(actor,''pos_fnb.view_orders'') or public.user_has_permission(actor,''orders.view'') or public.user_has_permission(actor,''inventory.view'')';
begin
 foreach target in array array['public.get_fnb_invoice_filter_options_20261023(uuid)'::regprocedure,'public.get_fnb_invoice_item_notes_20261023(uuid)'::regprocedure] loop
  d:=pg_get_functiondef(target);
  if position('public.user_has_permission(actor,''inventory.view'')' in d)=0 then
   if (length(d)-length(replace(d,old_guard,'')))/length(old_guard)<>1 then raise exception 'FNB_INVOICE_READ_GUARD_CHANGED';end if;
   execute replace(d,old_guard,new_guard);
  end if;
 end loop;
end $patch$;

create table if not exists public.fnb_invoice_item_options_20261023(
 invoice_item_id uuid primary key references public.invoice_items(id) on delete restrict,
 tenant_id uuid not null,branch_id uuid not null,
 modifier_selections jsonb not null,variant_label text,
 created_at timestamptz not null default now()
);
alter table public.fnb_invoice_item_options_20261023 enable row level security;
revoke all on table public.fnb_invoice_item_options_20261023 from public,anon,authenticated;
create or replace function public._capture_fnb_invoice_options_20261023()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.fnb_invoice_item_options_20261023(invoice_item_id,tenant_id,branch_id,modifier_selections,variant_label)
 select ii.id,i.tenant_id,i.branch_id,coalesce(ki.modifier_selections,'[]'::jsonb),ki.variant_label
 from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id
 join public.kitchen_order_items ki on ki.id=new.kitchen_order_item_id
 join public.kitchen_orders k on k.id=ki.kitchen_order_id
 where ii.id=new.invoice_item_id and i.source='fnb'
  and i.tenant_id=k.tenant_id and i.branch_id=k.branch_id
  and ii.product_id=ki.product_id and (k.invoice_id is null or k.invoice_id=i.id)
 on conflict(invoice_item_id) do nothing;
 if not found then raise exception 'FNB_INVOICE_OPTION_SOURCE_MISMATCH';end if;
 return new;
end $$;
revoke all on function public._capture_fnb_invoice_options_20261023() from public,anon,authenticated;
drop trigger if exists capture_fnb_invoice_options_20261023 on public.fnb_invoice_kitchen_line_sources;
create trigger capture_fnb_invoice_options_20261023 after insert on public.fnb_invoice_kitchen_line_sources
 for each row execute function public._capture_fnb_invoice_options_20261023();

create or replace function public.get_fnb_invoice_item_details_20261023(p_invoice_ids uuid[])
returns table(invoice_id uuid,invoice_item_id uuid,note text,modifier_selections jsonb,variant_label text,detail_source text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid:=public.get_user_tenant_id(); ids uuid[];
begin
 if actor is null or tenant is null or not exists(select 1 from public.profiles p where p.id=actor and p.tenant_id=tenant and coalesce(p.is_active,true)) then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 if not coalesce((public.user_has_permission(actor,'invoices.view') or public.user_has_permission(actor,'pos_fnb.view_orders') or public.user_has_permission(actor,'orders.view') or public.user_has_permission(actor,'inventory.view')),false) then raise exception 'INVOICE_VIEW_REQUIRED' using errcode='42501';end if;
 if p_invoice_ids is null or cardinality(p_invoice_ids)<1 or cardinality(p_invoice_ids)>100 or array_position(p_invoice_ids,null) is not null then raise exception 'INVOICE_IDS_INVALID';end if;
 select array_agg(distinct x) into ids from unnest(p_invoice_ids) x;
 if (select count(*) from public.invoices i where i.id=any(ids) and i.source='fnb' and i.tenant_id=tenant and i.deleted_at is null
   and (public.user_has_permission(actor,'reports.view_all_branches') or public.user_has_branch_access(actor,i.branch_id)))<>cardinality(ids)
 then raise exception 'INVOICE_ACCESS_DENIED' using errcode='42501';end if;
 return query
 select ii.invoice_id,ii.id,coalesce(ii.note,ki.note),
  case when snap.invoice_item_id is not null then snap.modifier_selections else ki.modifier_selections end,
  case when snap.invoice_item_id is not null then snap.variant_label else ki.variant_label end,
  case when snap.invoice_item_id is not null then 'snapshot' when ki.id is not null then 'legacy' else 'unlinked' end
 from public.invoices i join public.invoice_items ii on ii.invoice_id=i.id
 left join public.fnb_invoice_item_options_20261023 snap on snap.invoice_item_id=ii.id and snap.tenant_id=i.tenant_id and snap.branch_id=i.branch_id
 left join public.fnb_invoice_kitchen_line_sources s on s.invoice_item_id=ii.id
 left join public.kitchen_order_items ki on ki.id=s.kitchen_order_item_id and ki.product_id=ii.product_id
  and exists(select 1 from public.kitchen_orders k where k.id=ki.kitchen_order_id and k.invoice_id=i.id and k.tenant_id=tenant and k.branch_id=i.branch_id)
 where i.id=any(ids) and i.tenant_id=tenant order by ii.invoice_id,ii.id;
end $$;
revoke all on function public.get_fnb_invoice_item_details_20261023(uuid[]) from public,anon;
grant execute on function public.get_fnb_invoice_item_details_20261023(uuid[]) to authenticated;
comment on table public.fnb_invoice_item_options_20261023 is 'Private original item choices captured only on new checkout. No historical backfill, no current-menu default inference.';
notify pgrst,'reload schema';
commit;
