\set ON_ERROR_STOP on
\ir 00457_fnb_invoice_discount_allocation.integration.sql
alter table profiles add branch_id uuid,add full_name text;
alter table customers add group_id uuid,add is_active boolean default true;
create table customer_groups(id uuid primary key,tenant_id uuid,name text);
\ir ../migrations/00458_promotion_beneficiaries.sql
\ir ../migrations/00458_promotion_beneficiaries.sql
update profiles set branch_id='00000000-0000-0000-0000-000000000003',full_name='UAT manager';
insert into profiles(id,tenant_id,is_active,branch_id,full_name) values
('00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000002',true,'00000000-0000-0000-0000-000000000003','UAT employee');
insert into customer_groups values('00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000002','UAT group');
insert into customers(id,tenant_id,group_id) values
('00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000092'),
('00000000-0000-0000-0000-000000000094','00000000-0000-0000-0000-000000000002',null);
insert into promotions(id,tenant_id,beneficiary_kind,beneficiary_ids) values
('00000000-0000-0000-0000-000000000095','00000000-0000-0000-0000-000000000002','customer_group',array['00000000-0000-0000-0000-000000000092'::uuid]);
do $$ begin
 if not _promotion_customer_eligible_00458('00000000-0000-0000-0000-000000000095','00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000003') then raise exception 'Group buyer missing'; end if;
 if _promotion_customer_eligible_00458('00000000-0000-0000-0000-000000000095','00000000-0000-0000-0000-000000000094','00000000-0000-0000-0000-000000000003') then raise exception 'Wrong buyer received group discount'; end if;
 update promotions set beneficiary_kind='employee',beneficiary_ids='{}';
 if _promotion_customer_eligible_00458('00000000-0000-0000-0000-000000000095',null,'00000000-0000-0000-0000-000000000003') then raise exception 'Cashier identity was mistaken for buyer'; end if;
 perform promotion_link_employee_customer_00458('00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000091');
 if not _promotion_customer_eligible_00458('00000000-0000-0000-0000-000000000095','00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000003') then raise exception 'Linked active employee not eligible'; end if;
 update profiles set is_active=false where id='00000000-0000-0000-0000-000000000091';
 if _promotion_customer_eligible_00458('00000000-0000-0000-0000-000000000095','00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000003') then raise exception 'Inactive employee received benefit'; end if;
 if has_table_privilege('authenticated','promotion_employee_customers','UPDATE') then raise exception 'Employee link writable outside manager RPC'; end if;
end $$;
