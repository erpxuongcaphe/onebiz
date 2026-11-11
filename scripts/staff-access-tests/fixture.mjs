// Synthetic users, branches and minimal legacy helpers; no real data or credentials.
export async function initializeStaffAccessFixture(db, id) {
  await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.tenants(id uuid primary key);
create table public.branches(id uuid primary key,tenant_id uuid,name text,is_active boolean default true);
create table public.profiles(id uuid primary key,tenant_id uuid,role text,role_id uuid,full_name text,is_active boolean default true,branch_id uuid);
create table public.roles(id uuid primary key,tenant_id uuid,name text);
create table public.role_permissions(role_id uuid,permission_code text);
create table public.user_branches(user_id uuid,branch_id uuid,primary key(user_id,branch_id));
create table public.user_permission_overrides(id uuid default gen_random_uuid(),tenant_id uuid,user_id uuid,permission_code text,override_type text,note text,created_by uuid);
create table public.account_hierarchy_config(tenant_id uuid primary key,version bigint,document jsonb);
create table public.audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
create table public.kitchen_orders(id uuid primary key,tenant_id uuid,branch_id uuid);
create function public.get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from profiles where id=auth.uid()$$;
create function public.user_has_branch_access(p_user uuid,p_branch uuid) returns boolean language sql stable as $$select exists(select 1 from profiles p where p.id=p_user and (p.branch_id=p_branch or p.role='owner' or exists(select 1 from user_branches where user_id=p_user and branch_id=p_branch)))$$;
create function public.user_has_permission(p_user uuid,p_code text) returns boolean language sql stable as $$select exists(select 1 from profiles p where p.id=p_user and p.is_active and (p.role='owner' or (not exists(select 1 from user_permission_overrides where user_id=p_user and permission_code=p_code and override_type='revoke') and (exists(select 1 from role_permissions where role_id=p.role_id and permission_code=p_code) or exists(select 1 from user_permission_overrides where user_id=p_user and permission_code=p_code and override_type='grant')))))$$;
create function public.get_account_hierarchy() returns jsonb language sql stable as $$select jsonb_build_object('version',version,'document',document) from account_hierarchy_config where tenant_id=get_user_tenant_id()$$;
create function public._validate_account_hierarchy(p_tenant uuid,p_doc jsonb) returns void language plpgsql as $$begin
 if exists(select 1 from jsonb_array_elements(p_doc->'assignments') a where not exists(select 1 from profiles where id::text=a->>'userId' and tenant_id=p_tenant)) then raise exception 'BAD_ASSIGNMENT'; end if;
 if exists(select 1 from jsonb_array_elements(p_doc->'assignments') a, jsonb_array_elements_text(a->'managedBranchIds') b where not user_has_branch_access((a->>'userId')::uuid,b::uuid)) then raise exception 'BAD_SCOPE'; end if;
end$$;
create function public.save_account_hierarchy(p_doc jsonb,p_version bigint,p_fingerprint text) returns bigint language plpgsql as $$begin
 update account_hierarchy_config set document=p_doc,version=version+1 where tenant_id=get_user_tenant_id() and version=p_version;
 if not found then raise exception 'STALE'; end if; return p_version+1;
end$$;
create function public.update_managed_user_atomic(p_user uuid,p_patch jsonb,p_branches uuid[]) returns jsonb language plpgsql as $$begin
 update profiles set role_id=case when p_patch?'role_id' then (p_patch->>'role_id')::uuid else role_id end,branch_id=case when p_branches is null then branch_id else p_branches[1] end where id=p_user;
 if p_branches is not null then delete from user_branches where user_id=p_user; insert into user_branches select p_user,b from unnest(p_branches) b; end if;
 return '{}'; end$$;
create function public.split_kitchen_order_atomic(p_order_id uuid,p_mode text,p_item_ids uuid[],p_number_of_ways integer) returns boolean language sql as $$select public.user_has_permission(auth.uid(),'pos_fnb.split_bill')$$;
create function public.split_kitchen_order_quantities_20261020(p_order_id uuid,p_items jsonb,p_request_id uuid) returns boolean language sql as $$select public.user_has_permission(auth.uid(),'pos_fnb.split_bill')$$;
create function public.fnb_transfer_table_atomic(p_tenant_id uuid,p_order_id uuid,p_from_table_id uuid,p_to_table_id uuid) returns boolean language sql as $$select public.user_has_permission(auth.uid(),'pos_fnb.transfer_table')$$;
create function public.get_my_auth_bootstrap() returns jsonb language plpgsql as $$declare v_actor uuid:=auth.uid(); v_profile profiles; begin select * into v_profile from profiles where id=v_actor; return jsonb_build_object('scope',coalesce('[]'::jsonb,'[]'::jsonb)); end$$;
insert into tenants values('${id(1)}'),('${id(2)}');
insert into branches(id,tenant_id,name) values('${id(10)}','${id(1)}','Premium'),('${id(11)}','${id(1)}','Tư Búa'),('${id(12)}','${id(2)}','Other tenant');
insert into roles values('${id(20)}','${id(1)}','Staff');
insert into profiles(id,tenant_id,role,role_id,full_name,branch_id) values
 ('${id(100)}','${id(1)}','owner',null,'Owner','${id(10)}'),('${id(101)}','${id(1)}','staff','${id(20)}','Staff A','${id(10)}'),('${id(102)}','${id(2)}','staff',null,'Other','${id(12)}');
insert into role_permissions values('${id(20)}','pos_fnb.split_bill');
insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,note,created_by) values('${id(1)}','${id(101)}','products.view_cost','revoke','Keep original note','${id(100)}');
insert into kitchen_orders values('${id(30)}','${id(1)}','${id(10)}'),('${id(31)}','${id(1)}','${id(11)}'),('${id(32)}','${id(2)}','${id(12)}');
insert into account_hierarchy_config values('${id(1)}',1,'{"positions":[],"departments":[],"assignments":[],"globalAdminIds":[]}');
do $$ declare f record; begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace loop execute format('alter function %s set search_path=public',f.signature); end loop; end$$;
`);
}
