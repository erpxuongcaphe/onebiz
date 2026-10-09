\set ON_ERROR_STOP on
\ir 00458_promotion_beneficiaries.integration.sql
-- Add only the customer-code fixture columns; exercise the real allocator.
create table tenants(id uuid primary key);
insert into tenants values('00000000-0000-0000-0000-000000000002');
alter table customer_groups add code text,add note text,add discount_percent numeric default 0;
alter table customer_groups alter id set default gen_random_uuid();
alter table customers add name text,add code text,add is_internal boolean default false,add branch_id uuid;
alter table customers alter id set default gen_random_uuid();
alter table branches add tenant_id uuid,add code text;
\ir ../migrations/00437_customer_group_code_allocation.sql
\ir ../migrations/00463_employee_benefit_groups.sql
insert into customer_groups(tenant_id,name,code,discount_percent) values('00000000-0000-0000-0000-000000000002','Nhóm khách khác','NV',15);
\ir ../migrations/00463_employee_benefit_groups.sql
update profiles set is_active=true where id='00000000-0000-0000-0000-000000000091';
insert into profiles(id,tenant_id,is_active,branch_id,full_name) values
('00000000-0000-0000-0000-000000000096','00000000-0000-0000-0000-000000000002',true,'00000000-0000-0000-0000-000000000003','Employee 2');
create or replace function user_has_permission(uuid,text) returns boolean language sql as $$ select coalesce(current_setting('test.permission',true),'true')<>'false' $$;
create or replace function user_has_branch_access(uuid,uuid) returns boolean language sql as $$ select exists(select 1 from profiles where id=$1 and branch_id=$2) $$;
do $$ declare g uuid; c uuid; old_snapshots jsonb; rejected boolean; begin
 select jsonb_agg(to_jsonb(s)) into old_snapshots from fnb_invoice_discount_snapshots s;
 g:=employee_benefit_save_group_00463(null,'Nhóm quản lý',array['00000000-0000-0000-0000-000000000091'::uuid,'00000000-0000-0000-0000-000000000096'::uuid]);
 if (select count(*) from employee_benefit_members where group_id=g)<>2 then raise exception 'Multiple employees missing'; end if;
 select customer_id into c from promotion_employee_customers where profile_id='00000000-0000-0000-0000-000000000096';
 if (select code from customers where id=c) not like 'KHA-NV01-%' then raise exception 'Employee code differs from common allocator'; end if;
 if (select g.discount_percent from customer_groups g join customers x on x.group_id=g.id where x.id=c)<>0 then raise exception 'Unrelated customer-group discount leaked into staff benefit'; end if;
 if (select customer_id from promotion_employee_customers where profile_id='00000000-0000-0000-0000-000000000091')<>'00000000-0000-0000-0000-000000000093'::uuid then raise exception 'Existing identity rewritten'; end if;
 update promotions set beneficiary_kind='employee_group',beneficiary_ids=array[g] where id='00000000-0000-0000-0000-000000000095';
 if not _promotion_customer_eligible_00458('00000000-0000-0000-0000-000000000095',c,'00000000-0000-0000-0000-000000000003') then raise exception 'Group buyer not eligible'; end if;
 if _promotion_customer_eligible_00458('00000000-0000-0000-0000-000000000095',null,'00000000-0000-0000-0000-000000000003') then raise exception 'Cashier received buyer benefit'; end if;
 if _promotion_customer_eligible_00458('00000000-0000-0000-0000-000000000095',c,'00000000-0000-0000-0000-000000000099') then raise exception 'Wrong branch received benefit'; end if;
 perform employee_benefit_save_group_00463(g,'Nhóm quản lý',array['00000000-0000-0000-0000-000000000091'::uuid]);
 if _promotion_customer_eligible_00458('00000000-0000-0000-0000-000000000095',c,'00000000-0000-0000-0000-000000000003') then raise exception 'Removed member kept benefit'; end if;
 if (select count(*) from promotion_employee_customers where profile_id='00000000-0000-0000-0000-000000000096')<>1 then raise exception 'Duplicate identity'; end if;
 update profiles set is_active=false where id='00000000-0000-0000-0000-000000000091';
 if _promotion_customer_eligible_00458('00000000-0000-0000-0000-000000000095','00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000003') then raise exception 'Inactive employee received benefit'; end if;
 if jsonb_array_length(employee_benefit_options_00463()->'staff')<>2 then raise exception 'Inactive staff visible'; end if;
 if old_snapshots is distinct from (select jsonb_agg(to_jsonb(s)) from fnb_invoice_discount_snapshots s) then raise exception 'Old financial snapshot rewritten'; end if;
 if has_table_privilege('authenticated','employee_benefit_members','INSERT') then raise exception 'Membership editable directly'; end if;
 perform set_config('test.permission','false',false);
 rejected:=false;
 begin perform employee_benefit_save_group_00463(null,'Denied',array['00000000-0000-0000-0000-000000000096'::uuid]); exception when others then if SQLERRM<>'PERMISSION_DENIED' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'Unauthorized group creation'; end if;
end $$;
