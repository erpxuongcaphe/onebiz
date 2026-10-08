-- Disposable database only; these tables are synthetic, never production.
create schema auth;
create schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create function auth.uid() returns uuid language sql as $$
 select nullif(current_setting('test.actor', true), '')::uuid
$$;
create table profiles(id uuid primary key, tenant_id uuid, branch_id uuid, role text, is_active boolean);
create function user_has_permission(p_actor uuid, p_permission text) returns boolean language sql as $$
 select coalesce((select role = 'owner' from profiles where id = p_actor), false)
$$;
create function user_has_branch_access(p_actor uuid, p_branch uuid) returns boolean language sql as $$
 select coalesce((select branch_id = p_branch from profiles where id = p_actor), false)
$$;
create table shifts(id uuid primary key, tenant_id uuid, branch_id uuid, cashier_id uuid, status text);
create table restaurant_tables(id uuid primary key, tenant_id uuid, branch_id uuid, status text, current_order_id uuid, updated_at timestamptz);
create table kitchen_orders(id uuid primary key, tenant_id uuid, branch_id uuid, table_id uuid,
 invoice_id uuid, order_number text, status text, note text, merged_into_id uuid,
 created_at timestamptz default now(), updated_at timestamptz, cancel_reason_code text,
 cancel_reason text, cancelled_at timestamptz, cancelled_by uuid, cancel_approved_by uuid);
create table kitchen_order_items(id uuid primary key, kitchen_order_id uuid, product_id uuid,
 product_name text, variant_id uuid, variant_label text, quantity integer, unit_price numeric,
 note text, toppings jsonb, status text);
create table manager_otp_codes(id uuid primary key, tenant_id uuid, action_code text,
 target_meta jsonb, issued_by uuid, used_at timestamptz, used_by uuid);
create table pos_exception_events(id uuid primary key default gen_random_uuid(), tenant_id uuid,
 branch_id uuid, shift_id uuid, source text, event_type text, target_type text, target_id uuid,
 kitchen_order_id uuid, amount numeric, reason_code text, reason_note text, items_snapshot jsonb,
 metadata jsonb, requested_by uuid, approved_by uuid);
create function test_id(n integer) returns uuid language sql immutable as $$
 select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function test_fixture() returns void language plpgsql as $$ begin
 truncate profiles, shifts, restaurant_tables, kitchen_orders, kitchen_order_items, manager_otp_codes, pos_exception_events;
 insert into profiles values (test_id(1),test_id(2),test_id(3),'owner',true),
  (test_id(4),test_id(2),test_id(3),'cashier',true),
  (test_id(5),test_id(2),test_id(99),'owner',true);
 insert into restaurant_tables values(test_id(9),test_id(2),test_id(3),'occupied',test_id(10),now());
 insert into kitchen_orders(id,tenant_id,branch_id,table_id,order_number,status) values
  (test_id(10),test_id(2),test_id(3),test_id(9),'KB000010','ready'),
  (test_id(11),test_id(2),test_id(3),test_id(9),'KB000011','pending');
 insert into kitchen_order_items(id,kitchen_order_id,quantity,unit_price,status) values
  (test_id(20),test_id(10),2,10000,'ready'),(test_id(21),test_id(11),1,30000,'pending');
 insert into shifts values(test_id(30),test_id(2),test_id(3),test_id(1),'open');
 insert into manager_otp_codes values(test_id(40),test_id(2),'fnb.cancel_unpaid_bill',
  jsonb_build_object('entity_id',test_id(10)),test_id(1),now(),test_id(4));
 perform set_config('test.actor',test_id(1)::text,false);
end $$;
create function test_assert(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL: %',p_label; end if; end $$;
create function test_reject(p_sql text, p_message text) returns void language plpgsql as $$
declare v_rejected boolean := false;
begin
 begin execute p_sql; exception when others then
  if position(p_message in SQLERRM) = 0 then raise; end if;
  v_rejected := true;
 end;
 perform test_assert(v_rejected,p_message);
end $$;
