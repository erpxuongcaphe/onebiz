-- Disposable database; contacts only, never live profiles or invoices.
create schema auth;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create function test_id(n integer) returns uuid language sql immutable as $$select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table profiles(id uuid primary key,tenant_id uuid,branch_id uuid,is_active boolean,full_name text);
create table branches(id uuid primary key,tenant_id uuid,is_active boolean);
create table customers(id uuid primary key,tenant_id uuid,name text,code text,phone text,is_active boolean,is_internal boolean,is_walk_in boolean,canonical_customer_id uuid);
create table promotion_employee_customers(tenant_id uuid,customer_id uuid primary key,profile_id uuid);
create table employee_benefit_groups(id uuid primary key,tenant_id uuid,name text);
create table employee_benefit_members(group_id uuid,profile_id uuid);
create function public.user_has_permission(u uuid,c text) returns boolean language sql stable as $$select c='pos_fnb.checkout' and coalesce(current_setting('test.denied',true),'false')<>'true'$$;
create function public.user_has_branch_access(u uuid,b uuid) returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=u and branch_id=b)$$;
insert into branches values(test_id(3),test_id(1),true),(test_id(4),test_id(2),true);
insert into profiles values(test_id(5),test_id(1),test_id(3),true,'Thu ngân'),(test_id(6),test_id(1),test_id(99),true,'Cao Thị Huyền Trang');
insert into customers values(test_id(10),test_id(1),'Cao Thị Huyền Trang','KHA-NV-005','PRIVATE',true,false,false,null),
 (test_id(11),test_id(1),'Nguyễn Đỗ An','KH-AN','0901234567',true,false,false,null),
 (test_id(12),test_id(1),'Khách nội bộ công ty','INTERNAL','',true,true,false,null),
 (test_id(13),test_id(1),'Khách lẻ','WALKIN','',true,false,true,null),
 (test_id(14),test_id(2),'Other tenant','OTHER','',true,false,false,null),
 (test_id(15),test_id(1),'Alias','ALIAS','',true,false,false,test_id(11));
insert into promotion_employee_customers values(test_id(1),test_id(10),test_id(6));
insert into employee_benefit_groups values(test_id(20),test_id(1),'Manager'),(test_id(21),test_id(2),'Secret group');
insert into employee_benefit_members values(test_id(20),test_id(6)),(test_id(21),test_id(6));
select set_config('test.actor',test_id(5)::text,false);
create table before_install as select jsonb_build_object('customers',(select jsonb_agg(c) from customers c),'profiles',(select jsonb_agg(p) from profiles p),'links',(select jsonb_agg(l) from promotion_employee_customers l)) snapshot;
\ir ../migrations/20261029134118_fnb_buyer_employee_lookup.sql
\ir ../migrations/20261029134118_fnb_buyer_employee_lookup.sql
do $$ declare r jsonb; before_reads jsonb; begin
 select snapshot into before_reads from before_install;
 r:=fnb_buyer_lookup_v1(test_id(3),'cao thi huyen trang','employee');
 if jsonb_array_length(r)<>1 or r->0->>'id'<>test_id(10)::text or r->0->>'employee_id'<>test_id(6)::text
  or r->0->'benefit_groups'<>'["Manager"]'::jsonb or r->0->>'phone'<>'' then raise exception 'Employee lookup identity/group/minimal data mismatch'; end if;
 if jsonb_array_length(fnb_buyer_lookup_v1(test_id(3),'manager','employee'))<>1
 or jsonb_array_length(fnb_buyer_lookup_v1(test_id(3),'KHA-NV-005','employee'))<>1 then raise exception 'Group/code search failed'; end if;
 if jsonb_array_length(fnb_buyer_lookup_v1(test_id(3),'nguyen do an','customer'))<>1
 or jsonb_array_length(fnb_buyer_lookup_v1(test_id(3),'ĐỖ AN','customer'))<>1
 or jsonb_array_length(fnb_buyer_lookup_v1(test_id(3),'090123','customer'))<>1 then raise exception 'Vietnamese normalized contact search failed'; end if;
 if jsonb_array_length(fnb_buyer_lookup_v1(test_id(3),'','customer'))<>1 then raise exception 'Employee/internal/walkin/foreign/alias leaked into normal contacts'; end if;
 if not has_function_privilege('authenticated','fnb_buyer_lookup_v1(uuid,text,text)','EXECUTE')
 or has_function_privilege('anon','fnb_buyer_lookup_v1(uuid,text,text)','EXECUTE') then raise exception 'Lookup ACL incorrect'; end if;
 if (select jsonb_build_object('customers',(select jsonb_agg(c) from customers c),'profiles',(select jsonb_agg(p) from profiles p),'links',(select jsonb_agg(l) from promotion_employee_customers l))) is distinct from before_reads then raise exception 'Read path rewrote identities'; end if;
 begin perform fnb_buyer_lookup_v1(test_id(4),'','employee'); raise exception 'Foreign branch allowed'; exception when insufficient_privilege then null; end;
 begin perform fnb_buyer_lookup_v1(null,'','employee'); raise exception 'Null branch allowed'; exception when insufficient_privilege then null; end;
 begin perform fnb_buyer_lookup_v1(test_id(3),repeat('a',129),'employee'); raise exception 'Unbounded search allowed'; exception when invalid_parameter_value then null; end;
 begin perform fnb_buyer_lookup_v1(test_id(3),'','other'); raise exception 'Invalid mode allowed'; exception when invalid_parameter_value then null; end;
 update profiles set is_active=false where id=test_id(6);
 if fnb_buyer_lookup_v1(test_id(3),'','employee')<>'[]'::jsonb then raise exception 'Inactive employee leaked'; end if;
 update profiles set is_active=true where id=test_id(6);
 update customers set is_active=false where id=test_id(10);
 if fnb_buyer_lookup_v1(test_id(3),'','employee')<>'[]'::jsonb then raise exception 'Inactive buyer leaked'; end if;
 update customers set is_active=true where id=test_id(10);
 insert into customers select test_id(n),test_id(1),'Test '||n,'C-'||n,'',true,false,false,null from generate_series(100,120)n;
 if jsonb_array_length(fnb_buyer_lookup_v1(test_id(3),'','customer'))<>10 then raise exception 'Result limit missing'; end if;
 perform set_config('test.denied','true',false);
 begin perform fnb_buyer_lookup_v1(test_id(3),'','employee'); raise exception 'No POS permission allowed'; exception when insufficient_privilege then null; end;
 perform set_config('test.denied','false',false);perform set_config('test.actor','',false);
 begin perform fnb_buyer_lookup_v1(test_id(3),'','employee'); raise exception 'Anonymous caller allowed'; exception when insufficient_privilege then null; end;
end $$;
