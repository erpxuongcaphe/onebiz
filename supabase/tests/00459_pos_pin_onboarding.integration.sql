\set ON_ERROR_STOP on
create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;
create role anon;
create role authenticated;
create role service_role;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
create function auth.role() returns text language sql as $$ select current_setting('test.role',true) $$;
create table profiles(id uuid primary key,tenant_id uuid,full_name text,role text,is_active boolean default true,
 email text,role_id uuid,pos_pin_hash text,pos_pin_set_at timestamptz,pos_pin_set_by uuid,
 pos_pin_failed_attempts integer default 0,pos_pin_locked_until timestamptz,updated_at timestamptz);
create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
create table branches(id uuid primary key,tenant_id uuid,is_active boolean default true);
create table shifts(id uuid,tenant_id uuid,branch_id uuid,cashier_id uuid,status text,opened_at timestamptz);
create function public.hash_pos_pin(p_pin text) returns text language sql set search_path=public,extensions as $$ select crypt(p_pin,gen_salt('bf',4)) $$;
create function public.user_has_permission(p_user uuid,p_code text) returns boolean language sql as $$ select exists(select 1 from profiles where id=p_user and is_active and (role='owner' or p_code='pos_fnb.send_kitchen')) $$;
create function public.user_has_branch_access(p_user uuid,p_branch uuid) returns boolean language sql as $$ select exists(select 1 from profiles p join branches b on b.tenant_id=p.tenant_id where p.id=p_user and b.id=p_branch and b.is_active) $$;
-- Legacy manager-set API is present only to test that its browser grant is removed.
create function public.set_user_pos_pin(uuid,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
grant execute on function public.set_user_pos_pin(uuid,text) to authenticated;
\ir ../migrations/00071_self_change_pos_pin.sql
\ir 00459_remove_pin.setup.sql
\ir ../migrations/00459_pos_pin_onboarding.sql
\ir ../migrations/00459_pos_pin_onboarding.sql
\ir ../migrations/00460_persist_pos_pin_failed_attempts.sql
insert into profiles(id,tenant_id,full_name,role,email) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','Manager','owner','m@example.test'),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','Staff','cashier','s@example.test'),
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000020','Other tenant','cashier','o@example.test');
insert into branches values('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010',true);
select set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
select set_config('test.role','authenticated',false);
do $$ begin
 perform change_my_pos_pin_00459(null,'123456');
 if (select pos_pin_hash from profiles where id=auth.uid())='123456' then raise exception 'Plaintext PIN'; end if;
 begin perform change_my_pos_pin_00459(null,'654321'); raise exception 'Allowed existing PIN overwrite'; exception when others then if sqlerrm not like 'OLD_PIN_REQUIRED%' then raise; end if; end;
 begin perform change_my_pos_pin_00459('000000','654321'); raise exception 'Accepted wrong old PIN'; exception when others then if sqlerrm not like 'INVALID_OLD_PIN%' then raise; end if; end;
 perform change_my_pos_pin_00459('123456','654321');
 begin perform reset_my_pos_pin_after_password_00459(auth.uid(),'222222'); raise exception 'Reset available without server verification'; exception when others then if sqlerrm <> 'SERVER_ONLY' then raise; end if; end;
 begin perform request_pos_pin_reset_00459('00000000-0000-0000-0000-000000000001'); raise exception 'Staff reset manager'; exception when others then if sqlerrm <> 'PERMISSION_DENIED' then raise; end if; end;
 begin perform pos_pin_statuses_00459(); raise exception 'Staff accessed staff PIN statuses'; exception when others then if sqlerrm <> 'PERMISSION_DENIED' then raise; end if; end;
end $$;
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
do $$ declare result jsonb; begin
 begin perform request_pos_pin_reset_00459('00000000-0000-0000-0000-000000000003'); raise exception 'Cross tenant reset'; exception when others then if sqlerrm <> 'TARGET_USER_DENIED' then raise; end if; end;
 perform request_pos_pin_reset_00459('00000000-0000-0000-0000-000000000002');
 if not (select pos_pin_reset_required and pos_pin_hash is null from profiles where id='00000000-0000-0000-0000-000000000002') then raise exception 'Reset did not disable old PIN'; end if;
 result:=pos_pin_statuses_00459();
 if jsonb_array_length(result)<>2 or result::text like '%hash%' then raise exception 'Statuses exposed another tenant or hash'; end if;
end $$;
select set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
select change_my_pos_pin_00459(null,'333333');
do $$ begin if (select pos_pin_reset_required from profiles where id=auth.uid()) then raise exception 'Reset flag not cleared'; end if; end $$;
select set_config('test.role','service_role',false);
select reset_my_pos_pin_after_password_00459('00000000-0000-0000-0000-000000000002','444444');
select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
select set_config('test.role','authenticated',false);
do $$ declare result jsonb; begin
 for i in 1..10 loop
  result:=verify_pos_pin('00000000-0000-0000-0000-000000000002','999999','00000000-0000-0000-0000-000000000030');
  if (result->>'success')::boolean then raise exception 'Incorrect PIN accepted'; end if;
 end loop;
 if (select pos_pin_failed_attempts from profiles where id='00000000-0000-0000-0000-000000000002')<>10 then raise exception 'Retry counter rolled back'; end if;
 begin perform verify_pos_pin('00000000-0000-0000-0000-000000000002','444444','00000000-0000-0000-0000-000000000030'); raise exception 'Locked PIN accepted'; exception when others then if sqlerrm <> 'PIN_LOCKED' then raise; end if; end;
 update profiles set pos_pin_locked_until=now()-interval '1 second' where id='00000000-0000-0000-0000-000000000002';
 result:=verify_pos_pin('00000000-0000-0000-0000-000000000002','444444','00000000-0000-0000-0000-000000000030');
 if not (result->>'success')::boolean then raise exception 'Valid PIN rejected after lock expired'; end if;
 if exists(select 1 from audit_log where new_data::text like '%444444%' or new_data::text like '%333333%') then raise exception 'PIN logged in plaintext'; end if;
 if has_function_privilege('authenticated','reset_my_pos_pin_after_password_00459(uuid,text)','EXECUTE') then raise exception 'Password reset exposed to browser'; end if;
 if has_function_privilege('authenticated','set_user_pos_pin(uuid,text)','EXECUTE') then raise exception 'Manager can still choose an employee PIN'; end if;
end $$;
select 'PASS: create, change, self recovery, privileged reset, tenant isolation, status privacy, durable retry counter and lockout' result;
