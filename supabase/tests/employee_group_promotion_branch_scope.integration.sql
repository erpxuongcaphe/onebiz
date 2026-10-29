-- Disposable database only. No external services or real invoices.
create schema if not exists extensions;
create role anon nologin;
create role authenticated nologin;
create function test_id(n integer) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid $$;
create table branches(id uuid primary key,tenant_id uuid,is_active boolean default true);
create table profiles(id uuid primary key,tenant_id uuid,branch_id uuid,is_active boolean default true);
create table customers(id uuid primary key,tenant_id uuid,group_id uuid,is_active boolean default true,deleted_at timestamptz);
create table promotions(id uuid primary key,tenant_id uuid,beneficiary_kind text,beneficiary_ids uuid[],branch_ids uuid[]);
create table promotion_employee_customers(tenant_id uuid,customer_id uuid primary key,profile_id uuid);
create table employee_benefit_groups(id uuid primary key,tenant_id uuid);
create table employee_benefit_members(group_id uuid,profile_id uuid);
create table old_invoice(id uuid primary key,total numeric,discount numeric);
insert into old_invoice values(test_id(900),50000,25000);
create function user_has_branch_access(u uuid,b uuid) returns boolean language sql stable as
$$ select exists(select 1 from profiles where id=u and branch_id=b) $$;
insert into branches values(test_id(3),test_id(1),true),(test_id(4),test_id(1),true),
 (test_id(5),test_id(1),true),(test_id(6),test_id(2),true),(test_id(7),test_id(1),false);
-- Manager works at headquarters, not at any branch selected in the promotion.
insert into profiles values(test_id(10),test_id(1),test_id(99),true);
insert into customers values(test_id(20),test_id(1),test_id(40),true,null),
 (test_id(21),test_id(1),null,true,null),(test_id(22),test_id(2),null,true,null);
insert into promotion_employee_customers values(test_id(1),test_id(20),test_id(10));
insert into employee_benefit_groups values(test_id(30),test_id(1));
insert into employee_benefit_members values(test_id(30),test_id(10));
insert into promotions values(test_id(50),test_id(1),'employee_group',array[test_id(30)],array[test_id(3),test_id(4)]);
create table before_install as select jsonb_build_object('profiles',(select jsonb_agg(p) from profiles p),
 'customers',(select jsonb_agg(c) from customers c),'invoices',(select jsonb_agg(i) from old_invoice i)) snapshot;
\ir ../migrations/20261029090252_employee_group_promotion_branch_scope.sql
\ir ../migrations/20261029090252_employee_group_promotion_branch_scope.sql
do $$ declare branch uuid; begin
 if (select snapshot from before_install) is distinct from jsonb_build_object(
  'profiles',(select jsonb_agg(p) from profiles p),'customers',(select jsonb_agg(c) from customers c),
  'invoices',(select jsonb_agg(i) from old_invoice i)) then raise exception 'Installation rewrote business data'; end if;
 if user_has_branch_access(test_id(10),test_id(3)) then raise exception 'Fixture must reproduce missing employee login access'; end if;
 foreach branch in array array[test_id(3),test_id(4)] loop
  if not _promotion_customer_eligible_00458(test_id(50),test_id(20),branch) then raise exception 'Manager denied at selected branch'; end if;
 end loop;
 foreach branch in array array[test_id(5),test_id(6),test_id(7),null::uuid] loop
  if _promotion_customer_eligible_00458(test_id(50),test_id(20),branch) then raise exception 'Out-of-scope branch allowed'; end if;
 end loop;
 if _promotion_customer_eligible_00458(test_id(50),null,test_id(3))
 or _promotion_customer_eligible_00458(test_id(50),test_id(21),test_id(3))
 or _promotion_customer_eligible_00458(test_id(50),test_id(22),test_id(3)) then raise exception 'Wrong buyer received benefit'; end if;
 update promotions set branch_ids='{}';
 if not _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(5)) then raise exception 'All-branch program denied'; end if;
 if _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(6))
 or _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(7)) then raise exception 'Tenant/inactive branch boundary lost'; end if;
 update profiles set is_active=false;
 if _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(3)) then raise exception 'Inactive staff allowed'; end if;
 update profiles set is_active=true,tenant_id=test_id(2);
 if _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(3)) then raise exception 'Foreign staff allowed'; end if;
 update profiles set tenant_id=test_id(1);
 update customers set is_active=false where id=test_id(20);
 if _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(3)) then raise exception 'Inactive customer allowed'; end if;
 update customers set is_active=true,deleted_at=now() where id=test_id(20);
 if _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(3)) then raise exception 'Deleted customer allowed'; end if;
 update customers set deleted_at=null;
 update employee_benefit_groups set tenant_id=test_id(2);
 if _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(3)) then raise exception 'Foreign group allowed'; end if;
 update employee_benefit_groups set tenant_id=test_id(1);
 delete from employee_benefit_members;
 if _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(3)) then raise exception 'Removed member allowed'; end if;
 insert into employee_benefit_members values(test_id(30),test_id(10));
 delete from promotion_employee_customers;
 if _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(3)) then raise exception 'Unlinked employee allowed'; end if;
 insert into promotion_employee_customers values(test_id(1),test_id(20),test_id(10));
 -- Other beneficiary modes retain their existing behavior.
 update promotions set beneficiary_kind='employee',beneficiary_ids='{}';
 if _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(3)) then raise exception 'Individual employee policy changed'; end if;
 update promotions set beneficiary_kind='customer',beneficiary_ids=array[test_id(20)];
 if not _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(3)) then raise exception 'Customer policy changed'; end if;
 update promotions set beneficiary_kind='customer_group',beneficiary_ids=array[test_id(40)];
 if not _promotion_customer_eligible_00458(test_id(50),test_id(20),test_id(3)) then raise exception 'Customer-group policy changed'; end if;
 update promotions set beneficiary_kind='all';
 if not _promotion_customer_eligible_00458(test_id(50),null,test_id(3)) then raise exception 'General policy changed'; end if;
 if has_function_privilege('authenticated','_promotion_customer_eligible_00458(uuid,uuid,uuid)','EXECUTE')
 or has_function_privilege('anon','_promotion_customer_eligible_00458(uuid,uuid,uuid)','EXECUTE') then raise exception 'Private eligibility helper exposed'; end if;
end $$;
