-- New checkouts snapshot item notes; legacy notes are resolved read-only by exact source ID.
begin;
set local lock_timeout='3s';
do $patch$
declare d text; anchor text;
begin
 d:=replace(pg_get_functiondef('public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'::regprocedure),E'\r\n',E'\n');
 if position('modifier_selections, note as item_note_20261023' in d)=0 then
  anchor:='           modifier_selections';
  if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'FNB_ITEM_NOTE_SELECT_CHANGED';end if;
  d:=replace(d,anchor,anchor||', note as item_note_20261023');
  anchor:='quantity, unit_price, discount, vat_rate, vat_amount, total';
  if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'FNB_ITEM_NOTE_INSERT_CHANGED';end if;
  d:=replace(d,anchor,anchor||', note');
  anchor:='v_vat_amt, v_line_before_tax';
  if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'FNB_ITEM_NOTE_VALUES_CHANGED';end if;
  d:=replace(d,anchor,anchor||', coalesce(r.item_note_20261023, '''')');
  execute d;
 end if;
end $patch$;

create or replace function public.get_fnb_invoice_item_notes_20261023(p_invoice_id uuid)
returns table(invoice_item_id uuid,note text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid:=public.get_user_tenant_id(); inv public.invoices%rowtype;
begin
 if actor is null or tenant is null or not exists(select 1 from profiles p where p.id=actor and p.tenant_id=tenant and coalesce(p.is_active,true)) then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 if not coalesce((public.user_has_permission(actor,'invoices.view') or public.user_has_permission(actor,'pos_fnb.view_orders')),false) then raise exception 'INVOICE_VIEW_REQUIRED' using errcode='42501';end if;
 select * into inv from invoices i where i.id=p_invoice_id and i.tenant_id=tenant and i.deleted_at is null;
 if not found then return;end if;
 if not coalesce((public.user_has_permission(actor,'reports.view_all_branches') or public.user_has_branch_access(actor,inv.branch_id)),false) then raise exception 'BRANCH_ACCESS_DENIED' using errcode='42501';end if;
 if inv.source is distinct from 'fnb' then return;end if;
 return query
 select ii.id,coalesce(ii.note,ki.note)
 from invoice_items ii
 left join fnb_invoice_kitchen_line_sources s on s.invoice_item_id=ii.id
 left join kitchen_order_items ki on ki.id=s.kitchen_order_item_id
  and ki.product_id=ii.product_id and exists(
   select 1 from kitchen_orders k where k.id=ki.kitchen_order_id and k.invoice_id=inv.id and k.tenant_id=tenant and k.branch_id=inv.branch_id)
 where ii.invoice_id=inv.id;
end $$;
revoke all on function public.get_fnb_invoice_item_notes_20261023(uuid) from public,anon;
grant execute on function public.get_fnb_invoice_item_notes_20261023(uuid) to authenticated;
comment on function public.get_fnb_invoice_item_notes_20261023(uuid) is 'Scoped read-only item-note resolver. Stored note including explicit empty wins; legacy fallback requires exact source ID and same invoice/tenant/branch. No product-name matching or backfill.';
notify pgrst,'reload schema';
commit;
