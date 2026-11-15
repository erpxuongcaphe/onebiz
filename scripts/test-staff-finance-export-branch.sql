\set ON_ERROR_STOP on
do $$begin
 if current_database()<>'onebiz_hub_scope_v8_20261114' or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487
   or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE'; end if;
end$$;
begin;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into public.tenants(id,name,slug) values ('10000000-0000-0000-0000-000000000001','Synthetic tenant','finance-export-test');
insert into auth.users(id) values ('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','A','warehouse'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','B','warehouse'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','C','warehouse');
insert into public.roles(id,tenant_id,name) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic role');
insert into public.role_permissions(role_id,permission_code) values
 ('40000000-0000-0000-0000-000000000001','finance.view_cash_journal_company'),
 ('40000000-0000-0000-0000-000000000001','finance.view_cash_book'),
 ('40000000-0000-0000-0000-000000000001','finance.export_cash_journal'),
 ('40000000-0000-0000-0000-000000000001','reports.view_all_branches');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Owner','owner',null),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Staff','staff','40000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values ('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');
insert into public.cash_transactions(tenant_id,branch_id,code,type,category,amount,created_by,transaction_date) values
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','TEST-A','receipt','test',10,'20000000-0000-0000-0000-000000000002',current_date),
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TEST-B','receipt','test',20,'20000000-0000-0000-0000-000000000002',current_date);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.cash_journal_list_v1(current_date,current_date,null,null,null,null,'day',true,1,true,null);
 if (r->'totals'->>'count')::int<>2 then raise exception 'GLOBAL_EXPORT_CHANGED %',r;end if;
 r:=public.cash_journal_list_v2(current_date,current_date,null,null,null,null,'day',true,1,true,null);
 if (r->'totals'->>'count')::int<>2 then raise exception 'GLOBAL_EXPORT_V2_CHANGED %',r;end if;
 perform public.export_b2_plan_v1('30000000-0000-0000-0000-000000000001',date_trunc('month',current_date)::date);
 perform public.get_store_finance_reporting_source('journal',current_date,current_date,'30000000-0000-0000-0000-000000000001',null,true);
end$$;
reset role;
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','finance.export_cash_journal','revoke','20000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$declare r jsonb; denied boolean;begin
 r:=public.cash_journal_list_v1(current_date,current_date,'30000000-0000-0000-0000-000000000001',null,null,null,'day',true,1,true,null);
 if (r->'totals'->>'count')::int<>1 then raise exception 'ALLOWED_BRANCH_NOT_EXPORTED';end if;
 r:=public.cash_journal_list_v1(current_date,current_date,null,null,null,null,'day',true,1,false,null);
 if (r->'totals'->>'count')::int<>2 then raise exception 'READ_ACCESS_CHANGED';end if;
 denied:=false;begin perform public.cash_journal_list_v1(current_date,current_date,null,null,null,null,'day',true,1,true,null);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'UNSCOPED_EXPORT_ACCEPTED';end if;
 denied:=false;begin perform public.cash_journal_list_v2(current_date,current_date,'30000000-0000-0000-0000-000000000002',null,null,null,'day',true,1,true,null);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'DENIED_BRANCH_EXPORT_ACCEPTED';end if;
 denied:=false;begin perform public.export_b2_plan_v1('30000000-0000-0000-0000-000000000002',date_trunc('month',current_date)::date);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'DENIED_B2_EXPORT_ACCEPTED';end if;
 denied:=false;begin perform public.get_store_finance_reporting_source('journal',current_date,current_date,'30000000-0000-0000-0000-000000000002',null,true);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'DENIED_FINANCE_REPORT_EXPORT_ACCEPTED';end if;
end$$;
reset role;
delete from public.role_permissions where role_id='40000000-0000-0000-0000-000000000001' and permission_code='finance.export_cash_journal';
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','finance.export_cash_journal','grant','20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','finance.export_cash_journal','grant','20000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$declare r jsonb; denied boolean;begin
 r:=public.cash_journal_list_v2(current_date,current_date,'30000000-0000-0000-0000-000000000001',null,null,null,'day',true,1,true,null);
 if (r->'totals'->>'count')::int<>1 then raise exception 'BRANCH_GRANT_NOT_HONOURED';end if;
 perform public.export_b2_plan_v1('30000000-0000-0000-0000-000000000001',date_trunc('month',current_date)::date);
 perform public.get_store_finance_reporting_source('journal',current_date,current_date,'30000000-0000-0000-0000-000000000001',null,true);
 denied:=false;begin perform public.cash_journal_list_v1(current_date,current_date,null,null,null,null,'day',true,1,true,null);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'BRANCH_ONLY_UNSCOPED_EXPORT_ACCEPTED';end if;
 denied:=false;begin perform public.cash_journal_list_v1(current_date,current_date,'30000000-0000-0000-0000-000000000003',null,null,null,'day',true,1,true,null);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'UNASSIGNED_BRANCH_GRANT_ACCEPTED';end if;
end$$;
reset role;
insert into public.user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','finance.export_cash_journal','revoke','20000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform public.cash_journal_list_v1(current_date,current_date,'30000000-0000-0000-0000-000000000001',null,null,null,'day',true,1,true,null);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'GLOBAL_DENY_BYPASSED';end if;
end$$;
reset role;
delete from public.user_permission_overrides where user_id='20000000-0000-0000-0000-000000000002' and permission_code='finance.export_cash_journal';
delete from public.role_permissions where role_id='40000000-0000-0000-0000-000000000001' and permission_code='finance.view_cash_journal_company';
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform public.cash_journal_list_v1(current_date,current_date,'30000000-0000-0000-0000-000000000001',null,null,null,'day',true,1,true,null);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'EXPORT_BYPASSED_COMPANY_VIEW';end if;
end$$;
reset role;
update public.profiles set is_active=false where id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform public.cash_journal_list_v1(current_date,current_date,'30000000-0000-0000-0000-000000000001',null,null,null,'day',true,1,true,null);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'INACTIVE_USER_EXPORTED';end if;
end$$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
do $$declare r jsonb;begin
 r:=public.cash_journal_list_v1(current_date,current_date,null,null,null,null,'day',true,1,true,null);
 if (r->'totals'->>'count')::int<>2 then raise exception 'OWNER_EXPORT_CHANGED';end if;
end$$;
rollback;
