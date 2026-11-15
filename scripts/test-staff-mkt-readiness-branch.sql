\set ON_ERROR_STOP on
do $$begin
 if current_database()<>'onebiz_hub_scope_v8_20261114' or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE';end if;
end$$;
begin;
insert into public.tenants(id,name,slug) values ('11000000-0000-0000-0000-000000000001','Synthetic','mkt-readiness-scope');
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','A','store'),
 ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','B','store'),
 ('33000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','C','store');
insert into public.roles(id,tenant_id,name) values ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values ('22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic','staff','44000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values ('22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002');
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','mkt.view'),('44000000-0000-0000-0000-000000000001','mkt.readiness.store'),('44000000-0000-0000-0000-000000000001','mkt.manage_campaigns');
insert into public.mkt_campaigns(id,tenant_id,name) values ('66000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic campaign');
insert into public.mkt_campaign_readiness_items(id,tenant_id,campaign_id,title,required_role,required_branch_id) values
 ('77000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','A','store','33000000-0000-0000-0000-000000000001'),
 ('77000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','B','store','33000000-0000-0000-0000-000000000002'),
 ('77000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','C','store','33000000-0000-0000-0000-000000000003'),
 ('77000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','Shared','store',null),
 ('77000000-0000-0000-0000-000000000005','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','Finance','finance','33000000-0000-0000-0000-000000000002'),
 ('77000000-0000-0000-0000-000000000006','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','Operations','ops','33000000-0000-0000-0000-000000000002'),
 ('77000000-0000-0000-0000-000000000007','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','Warehouse','warehouse','33000000-0000-0000-0000-000000000002'),
 ('77000000-0000-0000-0000-000000000008','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','CEO','ceo','33000000-0000-0000-0000-000000000002');
insert into public.staff_branch_permission_catalog values ('mkt.readiness.store',1) on conflict do nothing;
select set_config('request.jwt.claim.sub','22000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$declare ids uuid[];reminder jsonb;begin
 ids:=public.mkt_confirmable_readiness_ids('66000000-0000-0000-0000-000000000001');
 if not ('77000000-0000-0000-0000-000000000001'::uuid=any(ids)) or not ('77000000-0000-0000-0000-000000000002'::uuid=any(ids))
  or '77000000-0000-0000-0000-000000000003'::uuid=any(ids) or not ('77000000-0000-0000-0000-000000000004'::uuid=any(ids)) then raise exception 'READINESS_ASSIGNED_BRANCH_SCOPE_FAILED';end if;
 reminder:=public.mkt_remind_readiness_item('66000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000002');
 if (reminder->>'reminded')::integer<>1 then raise exception 'READINESS_ASSIGNED_REMINDER_MISSING';end if;
 reminder:=public.mkt_remind_readiness_item('66000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000003');
 if (reminder->>'reminded')::integer<>0 then raise exception 'READINESS_UNASSIGNED_REMINDER_SENT';end if;
 perform public.mkt_confirm_readiness_item('66000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000002',null);
 begin perform public.mkt_confirm_readiness_item('66000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000003',null);
  raise exception 'READINESS_UNASSIGNED_ALLOWED';exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
end$$;
reset role;
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','mkt.readiness.store','revoke','22000000-0000-0000-0000-000000000002');
set local role authenticated;
do $$declare ids uuid[];begin
 ids:=public.mkt_confirmable_readiness_ids('66000000-0000-0000-0000-000000000001');
 if '77000000-0000-0000-0000-000000000002'::uuid=any(ids) then raise exception 'READINESS_BRANCH_REVOKE_FAILED';end if;
end$$;
reset role;
delete from public.role_permissions where permission_code='mkt.readiness.store';
delete from public.role_permissions where permission_code='mkt.manage_campaigns';
update public.user_branch_permission_overrides set override_type='grant' where permission_code='mkt.readiness.store';
delete from public.role_permissions where permission_code='mkt.view';
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','mkt.view','grant','22000000-0000-0000-0000-000000000002');
set local role authenticated;
do $$declare ids uuid[];begin
 ids:=public.mkt_confirmable_readiness_ids('66000000-0000-0000-0000-000000000001');
 if not ('77000000-0000-0000-0000-000000000002'::uuid=any(ids)) or '77000000-0000-0000-0000-000000000001'::uuid=any(ids)
  or '77000000-0000-0000-0000-000000000004'::uuid=any(ids) then raise exception 'READINESS_BRANCH_GRANT_FAILED';end if;
 if not (public.mkt_get_my_context()->>'canView')::boolean or not exists(select 1 from public.mkt_campaigns where id='66000000-0000-0000-0000-000000000001')
  or not exists(select 1 from public.mkt_campaign_readiness_items where id='77000000-0000-0000-0000-000000000002') then raise exception 'READINESS_BRANCH_GRANT_INACCESSIBLE';end if;
end$$;
reset role;
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
 select '11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002',code,'grant','22000000-0000-0000-0000-000000000002'
 from unnest(array['mkt.readiness.finance','mkt.readiness.ops','mkt.readiness.warehouse','mkt.readiness.ceo']) code;
set local role authenticated;
do $$declare ids uuid[];begin
 ids:=public.mkt_confirmable_readiness_ids('66000000-0000-0000-0000-000000000001');
 if not (array['77000000-0000-0000-0000-000000000005'::uuid,'77000000-0000-0000-0000-000000000006'::uuid,'77000000-0000-0000-0000-000000000007'::uuid,'77000000-0000-0000-0000-000000000008'::uuid] <@ ids) then raise exception 'READINESS_OTHER_ROLES_FAILED';end if;
end$$;
reset role;
delete from public.user_branch_permission_overrides where permission_code in ('mkt.readiness.finance','mkt.readiness.ops','mkt.readiness.warehouse','mkt.readiness.ceo');
insert into public.user_permission_overrides(tenant_id,user_id,permission_code,override_type) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','mkt.readiness.store','revoke');
set local role authenticated;
do $$begin
 if cardinality(public.mkt_confirmable_readiness_ids('66000000-0000-0000-0000-000000000001'))<>0 then raise exception 'READINESS_GLOBAL_REVOKE_FAILED';end if;
end$$;
reset role;
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','mkt.override_campaign');
set local role authenticated;
do $$begin
 if cardinality(public.mkt_confirmable_readiness_ids('66000000-0000-0000-0000-000000000001'))<>8 then raise exception 'READINESS_OVERRIDE_RIGHT_LOST';end if;
end$$;
reset role;
update public.profiles set is_active=false where id='22000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$begin
 if cardinality(public.mkt_confirmable_readiness_ids('66000000-0000-0000-0000-000000000001'))<>0 then raise exception 'INACTIVE_READINESS_ALLOWED';end if;
end$$;
rollback;
