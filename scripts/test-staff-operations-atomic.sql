\set ON_ERROR_STOP on
do $$begin if current_database()<>'onebiz_ops_rehearsal_v1' or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE';end if;end$$;
do $$begin if has_function_privilege('authenticated','public.save_staff_profile_access(uuid,text,jsonb)','execute') or not has_function_privilege('authenticated','public.save_staff_profile_operations(uuid,text,jsonb,text,jsonb,jsonb)','execute') then raise exception 'OLD_SAVE_BYPASS';end if;end$$;
begin;
insert into public.tenants(id,name,slug) values ('11000000-0000-0000-0000-000000000001','Synthetic','ops-atomic');
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000001'),('22000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic A','store'),
 ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','Synthetic B','store');
insert into public.roles(id,tenant_id,name) values ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic staff');
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','ops.view');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values
 ('22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic owner','owner',null),
 ('22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic staff','staff','44000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values ('22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002');
insert into public.ops_members(tenant_id,branch_id,user_id,member_role,capabilities,active) values
 ('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000002','coordinator',array['legacy'],true),
 ('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','manager',array['verify'],true);
insert into public.ops_q_grants(tenant_id,branch_id,user_id,can_audit,can_correct,can_accounting,active) values
 ('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000002',true,false,false,true);
select set_config('request.jwt.claim.sub','22000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$declare s jsonb; o jsonb; d jsonb;begin
 s:=public.get_staff_profile_access('22000000-0000-0000-0000-000000000002');
 o:=public.get_staff_operations_access('22000000-0000-0000-0000-000000000002');
 d:=jsonb_build_object('roleId',s->'user'->'roleId','branchIds',s->'user'->'branchIds','assignments','[]'::jsonb,'exceptions',s->'exceptions');
 perform public.save_staff_profile_operations('22000000-0000-0000-0000-000000000002',s->>'fingerprint',d,o->>'fingerprint','[]','[]');
 begin
  perform public.update_managed_user_atomic('22000000-0000-0000-0000-000000000002','{}',array['33000000-0000-0000-0000-000000000001'::uuid]);
  raise exception 'LEGACY_REMOVE_NOT_BLOCKED';
 exception when invalid_parameter_value then if sqlerrm<>'STAFF_OPS_USE_UNIFIED_EDITOR' then raise;end if;end;
end$$;
reset role;
do $$declare s jsonb; o jsonb; d jsonb; result jsonb; change jsonb; removed jsonb;begin
 s:=public.get_staff_profile_access('22000000-0000-0000-0000-000000000002');
 o:=public.get_staff_operations_access('22000000-0000-0000-0000-000000000002');
 d:=jsonb_build_object('roleId',s->'user'->'roleId','branchIds',s->'user'->'branchIds',
  'assignments',coalesce((select jsonb_agg(x) from jsonb_array_elements(s->'hierarchy'->'document'->'assignments') x where x->>'userId'='22000000-0000-0000-0000-000000000002'),'[]'::jsonb),'exceptions',s->'exceptions');
 result:=public.save_staff_profile_operations('22000000-0000-0000-0000-000000000002',s->>'fingerprint',d,o->>'fingerprint','[]','[]');
 if result->'operations'->>'fingerprint'<>o->>'fingerprint' then raise exception 'UNCHANGED_OPS_CHANGED';end if;
 begin
  removed:=jsonb_set(d,'{branchIds}','["33000000-0000-0000-0000-000000000001"]');
  change:=jsonb_build_array(jsonb_build_object('branchId','33000000-0000-0000-0000-000000000002','role','coordinator','capabilities','["legacy"]'::jsonb,'active',false));
  perform public.save_staff_profile_operations('22000000-0000-0000-0000-000000000002',s->>'fingerprint',removed,o->>'fingerprint',change,'["33000000-0000-0000-0000-000000000002"]');
  if (select active from public.ops_members where branch_id='33000000-0000-0000-0000-000000000002') or (select active from public.ops_q_grants where branch_id='33000000-0000-0000-0000-000000000002') or not (select active from public.ops_members where branch_id='33000000-0000-0000-0000-000000000001') then raise exception 'REMOVAL_NOT_ATOMIC';end if;
  raise exception 'ROLLBACK_SUBTEST';
 exception when raise_exception then if sqlerrm<>'ROLLBACK_SUBTEST' then raise;end if;end;
 change:=jsonb_build_array(jsonb_build_object('branchId','33000000-0000-0000-0000-000000000002','role','manager','capabilities','[]'::jsonb,'active',true));
 begin perform public.save_staff_profile_operations('22000000-0000-0000-0000-000000000002',s->>'fingerprint',d,o->>'fingerprint',change,'[]');raise exception 'QC_CONFLICT_NOT_CAUGHT';exception when invalid_parameter_value then if sqlerrm<>'STAFF_OPS_QC_CONFLICT' then raise;end if;end;
 if not (select active from public.ops_q_grants where branch_id='33000000-0000-0000-0000-000000000002') then raise exception 'FAILED_SAVE_CHANGED_QC';end if;
 result:=public.save_staff_profile_operations('22000000-0000-0000-0000-000000000002',s->>'fingerprint',d,o->>'fingerprint',change,'["33000000-0000-0000-0000-000000000002"]');
 if (select active from public.ops_q_grants where branch_id='33000000-0000-0000-0000-000000000002') or not exists(select 1 from public.ops_members where branch_id='33000000-0000-0000-0000-000000000002' and member_role='manager' and active) then raise exception 'ATOMIC_SAVE_FAILED';end if;
 begin perform public.save_staff_profile_operations('22000000-0000-0000-0000-000000000002',s->>'fingerprint',d,o->>'fingerprint','[]','[]');raise exception 'STALE_NOT_CAUGHT';exception when serialization_failure then if sqlerrm<>'STAFF_OPS_STALE' then raise;end if;end;
 s:=result->'profile';o:=result->'operations';removed:=jsonb_set(d,'{branchIds}','["33000000-0000-0000-0000-000000000001"]');
 begin perform public.save_staff_profile_operations('22000000-0000-0000-0000-000000000002',s->>'fingerprint',removed,o->>'fingerprint','[]','[]');raise exception 'OPS_REMOVE_NOT_CAUGHT';exception when invalid_parameter_value then if sqlerrm<>'STAFF_OPS_BRANCH_CONFLICT' then raise;end if;end;
 change:=jsonb_build_array(jsonb_build_object('branchId','33000000-0000-0000-0000-000000000002','role','manager','capabilities','[]'::jsonb,'active',false));
 result:=public.save_staff_profile_operations('22000000-0000-0000-0000-000000000002',s->>'fingerprint',removed,o->>'fingerprint',change,'[]');
 if (select active from public.ops_members where branch_id='33000000-0000-0000-0000-000000000002') or not (select active from public.ops_members where branch_id='33000000-0000-0000-0000-000000000001') then raise exception 'REMOVAL_DID_NOT_PRESERVE_OTHER_BRANCH';end if;
end$$;
rollback;
