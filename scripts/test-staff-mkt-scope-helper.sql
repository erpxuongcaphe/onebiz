\set ON_ERROR_STOP on
do $$begin if current_database() not in ('onebiz_hub_scope_20261114','onebiz_hub_scope_v2_20261114','onebiz_hub_scope_v3_20261114','onebiz_hub_scope_v4_20261114','onebiz_hub_scope_v5_20261114','onebiz_hub_scope_v6_20261114') or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE';end if;end$$;
begin;
insert into public.tenants(id,name,slug) values ('11000000-0000-0000-0000-000000000001','Synthetic','mkt-scope-a'),('11000000-0000-0000-0000-000000000002','Synthetic 2','mkt-scope-b');
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic A','store'),
 ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','Synthetic B','store');
insert into public.roles(id,tenant_id,name) values ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic staff');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values ('22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic staff','staff','44000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values ('22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002');
insert into public.mkt_campaigns(id,tenant_id,branch_id,name) values
 ('66000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic A'),
 ('66000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','Synthetic B'),
 ('66000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001',null,'Synthetic shared'),
 ('66000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000002',null,'Synthetic other tenant');
insert into public.mkt_channel_work_packages(id,tenant_id,campaign_id,channel_type,title) values
 ('77000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','other','Synthetic package A'),
 ('77000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000002','other','Synthetic package B');
insert into public.mkt_content_pillars(id,tenant_id,code,name) values ('88000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','SYN','Synthetic');
insert into public.mkt_content_items(id,tenant_id,campaign_id,work_package_id,pillar_id,title) values
 ('99000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',null,'77000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000001','Synthetic content A'),
 ('99000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001',null,'77000000-0000-0000-0000-000000000002','88000000-0000-0000-0000-000000000001','Synthetic content B');
-- Plans can reference a campaign and a work package from a different campaign.
insert into public.mkt_channel_plans(id,tenant_id,work_package_id,campaign_id) values ('aa000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000002','66000000-0000-0000-0000-000000000001'),
 ('aa000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001');
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values ('mkt.view',1),('mkt.manage_campaigns',1),('mkt.split_work_packages',1);
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000001','mkt.view','grant','22000000-0000-0000-0000-000000000002');
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000001','mkt.manage_campaigns','grant','22000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','22000000-0000-0000-0000-000000000002',true);
do $$declare created jsonb;begin
 created:=public.mkt_create_campaign('Synthetic new',null,null,null,0,'33000000-0000-0000-0000-000000000001',null,'[]');
 if created->>'campaignId' is null then raise exception 'MKT_CREATE_BRANCH_FAILED';end if;
 if not exists(select 1 from public.mkt_campaigns where id=(created->>'campaignId')::uuid and branch_id='33000000-0000-0000-0000-000000000001') then raise exception 'MKT_CREATED_WRONG_BRANCH';end if;
 begin
  perform public.mkt_create_content_item('66000000-0000-0000-0000-000000000003',null,'Shared content','other','low','88000000-0000-0000-0000-000000000001');
  raise exception 'MKT_BRANCH_GRANT_SHARED_CONTENT_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 perform public.mkt_create_content_item('66000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','Scoped content','other','low','88000000-0000-0000-0000-000000000001');
 begin
  perform public.mkt_create_content_item('66000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000002','Cross branch content','other','low','88000000-0000-0000-0000-000000000001');
  raise exception 'MKT_CONTENT_WRONG_PACKAGE_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 begin
  perform public.mkt_add_readiness_item('66000000-0000-0000-0000-000000000003','Shared readiness','store','33000000-0000-0000-0000-000000000001',null);
  raise exception 'MKT_BRANCH_GRANT_SHARED_READINESS_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 perform public.mkt_add_readiness_item('66000000-0000-0000-0000-000000000001','Scoped readiness','store','33000000-0000-0000-0000-000000000001',null);
 begin
  perform public.mkt_add_readiness_item('66000000-0000-0000-0000-000000000002','Wrong branch readiness','store','33000000-0000-0000-0000-000000000002',null);
  raise exception 'MKT_READINESS_WRONG_BRANCH_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 begin
  perform public.mkt_create_work_package('66000000-0000-0000-0000-000000000003','other','Shared package',null,null,null,null);
  raise exception 'MKT_BRANCH_GRANT_SHARED_PACKAGE_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 perform public.mkt_create_work_package('66000000-0000-0000-0000-000000000001','other','Scoped package',null,null,null,null);
 begin
  perform public.mkt_create_work_package('66000000-0000-0000-0000-000000000002','other','Wrong branch package',null,null,null,null);
  raise exception 'MKT_PACKAGE_WRONG_BRANCH_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 begin
  perform public.mkt_change_campaign_status('66000000-0000-0000-0000-000000000003','paused',null);
  raise exception 'MKT_BRANCH_GRANT_SHARED_STATUS_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 perform public.mkt_change_campaign_status('66000000-0000-0000-0000-000000000001','paused',null);
 begin
  perform public.mkt_update_campaign('66000000-0000-0000-0000-000000000003','{"name":"Changed shared"}'::jsonb);
  raise exception 'MKT_BRANCH_GRANT_SHARED_UPDATE_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 perform public.mkt_update_campaign('66000000-0000-0000-0000-000000000001','{"branchId":"33000000-0000-0000-0000-000000000001"}'::jsonb);
 perform public.mkt_update_campaign('66000000-0000-0000-0000-000000000001','{"name":"Changed A"}'::jsonb);
 begin
  perform public.mkt_update_campaign('66000000-0000-0000-0000-000000000001','{"branchId":"33000000-0000-0000-0000-000000000002"}'::jsonb);
  raise exception 'MKT_MOVE_WRONG_BRANCH_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 begin
  if not exists(select 1 from public.mkt_campaigns where id='66000000-0000-0000-0000-000000000001' and branch_id='33000000-0000-0000-0000-000000000001') then raise exception 'MKT_DENIED_MOVE_CHANGED_BRANCH';end if;
  perform public.mkt_update_campaign('66000000-0000-0000-0000-000000000002','{"name":"Changed B"}'::jsonb);
  raise exception 'MKT_UPDATE_WRONG_BRANCH_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 begin
  perform public.mkt_create_campaign('Synthetic B',null,null,null,0,'33000000-0000-0000-0000-000000000002',null,'[]');
  raise exception 'MKT_CREATE_WRONG_BRANCH_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 begin
  perform public.mkt_create_campaign('Synthetic shared',null,null,null,0,null,null,'[]');
  raise exception 'MKT_CREATE_SHARED_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 begin
  perform public.mkt_change_campaign_status('66000000-0000-0000-0000-000000000002','paused',null);
  raise exception 'MKT_STATUS_WRONG_BRANCH_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
end$$;
do $$begin if (select count(*) from public.mkt_campaigns where name in ('Synthetic B','Synthetic shared'))<>2 then raise exception 'MKT_DENIED_CAMPAIGN_CREATED';end if;end$$;
do $$begin if not exists(select 1 from public.mkt_campaigns where id='66000000-0000-0000-0000-000000000002' and name='Synthetic B') then raise exception 'MKT_DENIED_UPDATE_CHANGED_NAME';end if;end$$;
do $$begin if not exists(select 1 from public.mkt_campaigns where id='66000000-0000-0000-0000-000000000002' and status='planning') then raise exception 'MKT_DENIED_STATUS_CHANGED';end if;end$$;
update public.user_branch_permission_overrides set override_type='revoke' where user_id='22000000-0000-0000-0000-000000000002' and branch_id='33000000-0000-0000-0000-000000000001' and permission_code='mkt.manage_campaigns';
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000001','mkt.split_work_packages','grant','22000000-0000-0000-0000-000000000002');
do $$begin
 perform public.mkt_create_content_item('66000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','Split-only content','other','low','88000000-0000-0000-0000-000000000001');
 begin
  perform public.mkt_create_content_item('66000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000002','Split cross branch','other','low','88000000-0000-0000-0000-000000000001');
  raise exception 'MKT_SPLIT_CONTENT_CROSS_BRANCH_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 perform public.mkt_create_work_package('66000000-0000-0000-0000-000000000001','other','Split-only package',null,null,null,null);
 begin
  perform public.mkt_create_work_package('66000000-0000-0000-0000-000000000002','other','Split wrong branch',null,null,null,null);
  raise exception 'MKT_SPLIT_WRONG_BRANCH_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
end$$;
do $$begin if exists(select 1 from public.mkt_campaign_readiness_items where title in ('Wrong branch readiness','Shared readiness')) then raise exception 'MKT_DENIED_READINESS_CREATED';end if;end$$;
do $$begin if not exists(select 1 from public.mkt_channel_work_packages where title='Scoped package' and campaign_id='66000000-0000-0000-0000-000000000001') then raise exception 'MKT_PACKAGE_WRONG_CAMPAIGN';end if;end$$;
do $$begin if exists(select 1 from public.mkt_channel_work_packages where title in ('Wrong branch package','Split wrong branch')) then raise exception 'MKT_DENIED_PACKAGE_CREATED';end if;end$$;
do $$begin if exists(select 1 from public.mkt_content_items where title in ('Cross branch content','Split cross branch')) then raise exception 'MKT_DENIED_CONTENT_CREATED';end if;end$$;
update public.user_branch_permission_overrides set override_type='grant' where user_id='22000000-0000-0000-0000-000000000002' and branch_id='33000000-0000-0000-0000-000000000001' and permission_code='mkt.manage_campaigns';
do $$declare u uuid:='22000000-0000-0000-0000-000000000002';begin
 if not public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000001')
  or public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000002')
  or public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000003')
  or public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000004') then raise exception 'MKT_BRANCH_SCOPE_FAILED';end if;
 if has_function_privilege('authenticated','public._staff_mkt_campaign_permission(uuid,text,uuid)','execute') or has_function_privilege('anon','public._staff_mkt_campaign_permission(uuid,text,uuid)','execute') then raise exception 'MKT_PRIVATE_HELPER_EXPOSED';end if;
 if not public._staff_mkt_linked_permission(u,'mkt.view',null,'77000000-0000-0000-0000-000000000001',null,null)
  or public._staff_mkt_linked_permission(u,'mkt.view',null,'77000000-0000-0000-0000-000000000002',null,null)
  or public._staff_mkt_linked_permission(u,'mkt.view','66000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000002',null,null)
  or public._staff_mkt_linked_permission(u,'mkt.view','66000000-0000-0000-0000-000000000004',null,null,null)
  or public._staff_mkt_linked_permission(u,'mkt.view',null,'77000000-0000-0000-0000-000000000099',null,null)
  or not public._staff_mkt_linked_permission(u,'mkt.view',null,null,'99000000-0000-0000-0000-000000000001',null)
  or public._staff_mkt_linked_permission(u,'mkt.view',null,null,'99000000-0000-0000-0000-000000000099',null)
  or public._staff_mkt_linked_permission(u,'mkt.view',null,null,'99000000-0000-0000-0000-000000000002',null)
  or public._staff_mkt_linked_permission(u,'mkt.view',null,null,null,'aa000000-0000-0000-0000-000000000099')
  or public._staff_mkt_linked_permission(u,'mkt.view',null,null,null,'aa000000-0000-0000-0000-000000000001')
  or not public._staff_mkt_linked_permission(u,'mkt.view',null,null,null,'aa000000-0000-0000-0000-000000000002')
  or public._staff_mkt_linked_permission(u,'mkt.view',null,null,null,null) then raise exception 'MKT_INDIRECT_SCOPE_FAILED';end if;
 if has_function_privilege('authenticated','public._staff_mkt_linked_permission(uuid,text,uuid,uuid,uuid,uuid)','execute') then raise exception 'MKT_LINKED_HELPER_EXPOSED';end if;
end$$;
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','mkt.view');
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','mkt.manage_campaigns');
do $$begin if not public._staff_mkt_linked_permission('22000000-0000-0000-0000-000000000002','mkt.view',null,null,null,null) then raise exception 'MKT_LEGACY_SHARED_VIEW_LOST';end if;end$$;
do $$begin
 perform public.mkt_create_content_item('66000000-0000-0000-0000-000000000002','77000000-0000-0000-0000-000000000002','Legacy content B','other','low','88000000-0000-0000-0000-000000000001');
 perform public.mkt_create_campaign('Synthetic legacy B',null,null,null,0,'33000000-0000-0000-0000-000000000002',null,'[]');
 perform public.mkt_create_content_item('66000000-0000-0000-0000-000000000003',null,'Legacy shared content','other','low','88000000-0000-0000-0000-000000000001');
 perform public.mkt_create_work_package('66000000-0000-0000-0000-000000000003','other','Legacy shared package',null,null,null,null);
 perform public.mkt_add_readiness_item('66000000-0000-0000-0000-000000000003','Legacy shared readiness','store','33000000-0000-0000-0000-000000000001',null);
 perform public.mkt_change_campaign_status('66000000-0000-0000-0000-000000000003','paused',null);
 perform public.mkt_update_campaign('66000000-0000-0000-0000-000000000003','{"name":"Legacy shared update"}'::jsonb);
 perform public.mkt_create_campaign('Synthetic legacy shared',null,null,null,0,null,null,'[]');
end$$;
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','mkt.view','revoke','22000000-0000-0000-0000-000000000002');
do $$declare u uuid:='22000000-0000-0000-0000-000000000002';begin
 if public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000002') or not public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000003') then raise exception 'MKT_SHARED_OR_DENY_FAILED';end if;
end$$;
insert into public.user_permission_overrides(tenant_id,user_id,permission_code,override_type) values ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','mkt.view','revoke');
do $$begin if public._staff_mkt_campaign_permission('22000000-0000-0000-0000-000000000002','mkt.view','66000000-0000-0000-0000-000000000001') then raise exception 'MKT_GLOBAL_DENY_BYPASSED';end if; if public._staff_mkt_linked_permission('22000000-0000-0000-0000-000000000002','mkt.view',null,'77000000-0000-0000-0000-000000000001',null,null) then raise exception 'MKT_LINKED_GLOBAL_DENY_BYPASSED';end if;end$$;
do $$begin if public._staff_mkt_linked_permission('22000000-0000-0000-0000-000000000002','mkt.view',null,null,null,null) then raise exception 'MKT_SHARED_GLOBAL_DENY_BYPASSED';end if;end$$;
insert into public.user_permission_overrides(tenant_id,user_id,permission_code,override_type) values ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','mkt.manage_campaigns','revoke');
do $$begin
 begin
  perform public.mkt_update_campaign('66000000-0000-0000-0000-000000000001','{"name":"Denied globally"}'::jsonb);
  raise exception 'MKT_GLOBAL_UPDATE_DENY_BYPASSED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 begin
  perform public.mkt_change_campaign_status('66000000-0000-0000-0000-000000000001','paused',null);
  raise exception 'MKT_GLOBAL_STATUS_DENY_BYPASSED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 begin
  perform public.mkt_add_readiness_item('66000000-0000-0000-0000-000000000001','Denied readiness','store','33000000-0000-0000-0000-000000000001',null);
  raise exception 'MKT_GLOBAL_READINESS_DENY_BYPASSED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 begin
  perform public.mkt_create_campaign('Denied globally',null,null,null,0,'33000000-0000-0000-0000-000000000001',null,'[]');
  raise exception 'MKT_GLOBAL_MANAGE_DENY_BYPASSED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
end$$;
select public.mkt_create_content_item('66000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','Independent split content','other','low','88000000-0000-0000-0000-000000000001');
select public.mkt_create_work_package('66000000-0000-0000-0000-000000000001','other','Independent split access',null,null,null,null);
insert into public.user_permission_overrides(tenant_id,user_id,permission_code,override_type) values ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','mkt.split_work_packages','revoke');
do $$begin
 begin
  perform public.mkt_create_content_item('66000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','Denied content','other','low','88000000-0000-0000-0000-000000000001');
  raise exception 'MKT_GLOBAL_CONTENT_DENY_BYPASSED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
 begin
  perform public.mkt_create_work_package('66000000-0000-0000-0000-000000000001','other','Denied package',null,null,null,null);
  raise exception 'MKT_GLOBAL_PACKAGE_DENY_BYPASSED';
 exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ROLE' then raise;end if;end;
end$$;
rollback;
