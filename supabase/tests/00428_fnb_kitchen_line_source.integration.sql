\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'kitchen_line_source_test' or to_regclass('public.invoices') is not null then
    raise exception 'Requires a fresh isolated kitchen_line_source_test database';
  end if;
end $$;
create schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create table invoices(id uuid primary key, tenant_id uuid, branch_id uuid, source text);
create table invoice_items(id uuid primary key default gen_random_uuid(), invoice_id uuid,
  product_id uuid, quantity numeric, returned_qty numeric default 0);
create table kitchen_orders(id uuid primary key, tenant_id uuid, branch_id uuid, invoice_id uuid);
create table kitchen_order_items(id uuid primary key, kitchen_order_id uuid, product_id uuid,
  variant_id uuid, product_name text, variant_label text, quantity numeric, unit_price numeric,
  toppings jsonb, modifier_selections jsonb);

-- Adapter keeps the production hook anchors and the one-invoice-line-per-source loop.
create function public._fnb_complete_payment_impl_00230(
  p_kitchen_order_id uuid, p_customer_id uuid, p_customer_name text, p_payment_method text,
  p_payment_breakdown jsonb, p_paid numeric, p_discount_amount numeric, p_note text,
  p_created_by uuid, p_shift_id uuid, p_tip_amount numeric
) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_invoice_id uuid := gen_random_uuid(); v_invoice_item_id uuid; r record;
begin
  insert into invoices select v_invoice_id, tenant_id, branch_id, 'fnb'
    from kitchen_orders where id=p_kitchen_order_id;
  for r in
    select product_id, variant_id, product_name, variant_label, quantity, unit_price, toppings,
           modifier_selections
    from public.kitchen_order_items where kitchen_order_id = p_kitchen_order_id
  loop
    insert into invoice_items(invoice_id,product_id,quantity)
    values(v_invoice_id,r.product_id,r.quantity) returning id into v_invoice_item_id;
  end loop;
  update kitchen_orders set invoice_id=v_invoice_id where id=p_kitchen_order_id;
  return jsonb_build_object('invoice_id',v_invoice_id);
end;
$$;
revoke all on function public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)
  from public, anon, authenticated;
insert into invoices values('00000000-0000-0000-0000-000000000090',
  '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','fnb');
insert into invoice_items(id,invoice_id,product_id,quantity) values(
  '00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000090',
  '00000000-0000-0000-0000-000000000003',2);
\ir ../migrations/00423_fnb_invoice_kitchen_line_source.sql
\ir ../migrations/00423_fnb_invoice_kitchen_line_source.sql
do $$ begin
  if exists(select 1 from fnb_invoice_kitchen_line_sources) then
    raise exception 'Legacy rows were inferred'; end if;
end $$;

insert into kitchen_orders values
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',null),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000002',null);
insert into kitchen_order_items values
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003',null,'Same drink','M',2,10000,'[]','[{"note":"less ice"}]'),
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003',null,'Same drink','M',2,10000,'[]','[{"note":"more ice"}]'),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000003',null,'Same drink','M',2,10000,'[]','[]');

do $$ declare v_invoice uuid; v_line uuid; v_other_line uuid; v_count integer; v_msg text; begin
  select (public._fnb_complete_payment_impl_00230(
    '00000000-0000-0000-0000-000000000010',null,null,'cash',null,40000,0,null,null,null,0
  )->>'invoice_id')::uuid into v_invoice;
  select count(*) into v_count from fnb_invoice_kitchen_line_sources;
  if v_count<>2 then raise exception 'Same SKU/size/quantity rows not linked independently'; end if;
  select s.invoice_item_id into v_line from fnb_invoice_kitchen_line_sources s
   where s.kitchen_order_item_id='00000000-0000-0000-0000-000000000020';
  select s.invoice_item_id into v_other_line from fnb_invoice_kitchen_line_sources s
   where s.kitchen_order_item_id='00000000-0000-0000-0000-000000000021';
  if v_line is null or v_other_line is null or v_line=v_other_line then raise exception 'Identity missing'; end if;
  update invoice_items set returned_qty=1 where id=v_line;
  if (select ii.returned_qty from invoice_items ii where ii.id=v_other_line)<>0 then
    raise exception 'Return leaked to same-product sibling'; end if;
  perform _capture_fnb_kitchen_line_source_00423(v_line,'00000000-0000-0000-0000-000000000020');
  begin perform _capture_fnb_kitchen_line_source_00423(v_line,'00000000-0000-0000-0000-000000000021');
  exception when others then v_msg:=sqlerrm; end;
  if v_msg is distinct from 'FNB_KITCHEN_LINE_SOURCE_CONFLICT' then raise exception 'Source overwrite allowed'; end if;
  v_msg:=null;
  begin perform _capture_fnb_kitchen_line_source_00423(v_line,'00000000-0000-0000-0000-000000000022');
  exception when others then v_msg:=sqlerrm; end;
  if v_msg is distinct from 'FNB_KITCHEN_LINE_SOURCE_MISMATCH' then raise exception 'Cross tenant allowed'; end if;
  update invoices set source='pos' where id=v_invoice; v_msg:=null;
  begin perform _capture_fnb_kitchen_line_source_00423(v_line,'00000000-0000-0000-0000-000000000020');
  exception when others then v_msg:=sqlerrm; end;
  if v_msg is distinct from 'FNB_KITCHEN_LINE_SOURCE_MISMATCH' then raise exception 'Retail capture allowed'; end if;
  update invoices set source='fnb' where id=v_invoice;
  update invoices set branch_id='00000000-0000-0000-0000-000000000098' where id=v_invoice; v_msg:=null;
  begin perform _capture_fnb_kitchen_line_source_00423(v_line,'00000000-0000-0000-0000-000000000020');
  exception when others then v_msg:=sqlerrm; end;
  if v_msg is distinct from 'FNB_KITCHEN_LINE_SOURCE_MISMATCH' then raise exception 'Cross branch allowed'; end if;
  update invoices set branch_id='00000000-0000-0000-0000-000000000002' where id=v_invoice;
  update kitchen_orders set invoice_id='00000000-0000-0000-0000-000000000090'
   where id='00000000-0000-0000-0000-000000000010'; v_msg:=null;
  begin perform _capture_fnb_kitchen_line_source_00423(v_line,'00000000-0000-0000-0000-000000000020');
  exception when others then v_msg:=sqlerrm; end;
  if v_msg is distinct from 'FNB_KITCHEN_LINE_SOURCE_MISMATCH' then raise exception 'Other invoice allowed'; end if;
  update kitchen_orders set invoice_id=v_invoice where id='00000000-0000-0000-0000-000000000010';
  update invoice_items set quantity=3 where id=v_line; v_msg:=null;
  begin perform _capture_fnb_kitchen_line_source_00423(v_line,'00000000-0000-0000-0000-000000000020');
  exception when others then v_msg:=sqlerrm; end;
  if v_msg is distinct from 'FNB_KITCHEN_LINE_SOURCE_MISMATCH' then raise exception 'Quantity mismatch allowed'; end if;
  if has_function_privilege('authenticated','public._capture_fnb_kitchen_line_source_00423(uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','public._capture_fnb_kitchen_line_source_00423(uuid,uuid)','EXECUTE')
    or has_table_privilege('authenticated','public.fnb_invoice_kitchen_line_sources','INSERT')
    or has_table_privilege('anon','public.fnb_invoice_kitchen_line_sources','SELECT') then
    raise exception 'Private capture exposure'; end if;
  if has_function_privilege('authenticated','public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)','EXECUTE') then
    raise exception 'Payment helper ACL changed'; end if;
end $$;

-- A failure in the same transaction must not leave source links behind.
do $$ declare v_before integer; begin
  select count(*) into v_before from fnb_invoice_kitchen_line_sources;
  begin
    perform public._fnb_complete_payment_impl_00230(
      '00000000-0000-0000-0000-000000000011',null,null,'cash',null,20000,0,null,null,null,0);
    raise exception 'TEST_ROLLBACK';
  exception when raise_exception then
    if sqlerrm <> 'TEST_ROLLBACK' then raise; end if;
  end;
  if (select count(*) from fnb_invoice_kitchen_line_sources)<>v_before
    or (select invoice_id from kitchen_orders where id='00000000-0000-0000-0000-000000000011') is not null then
    raise exception 'Rollback left source or invoice'; end if;
end $$;
